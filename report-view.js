/** Read-only, dependency-free presentation of battle-report.js snapshots.
 * Returns escaped HTML. Never reads live game state, stores data, or downloads.
 */
const LIMITS = Object.freeze({ samples: 256, objectives: 32, targets: 64, composition: 16, limitations: 24, text: 512 });
const SIDES = ['You', 'Enemy'];
const METRICS = [
  { key: 'gold', title: 'Gold on hand', unit: 'gold', detail: 'A balance at each sample, not gold earned or net profit.' },
  { key: 'income', title: 'Income rate', unit: 'gold / sec', detail: 'The income rate at each sample, not total income earned.' },
  { key: 'armyCount', title: 'Living army', unit: 'units', detail: 'Living units at each sample. This does not measure units recruited or losses.' },
  { key: 'baseHp', title: 'Citadel health', unit: 'HP', detail: 'Citadel health at each sample.' },
];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = field => { throw new TypeError(`Battle report ${field} is missing or invalid.`); };
const number = (value, field) => {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail(field);
  return value;
};
const integer = (value, field) => { number(value, field); if (!Number.isInteger(value)) fail(field); return value; };
const text = (value, field) => { if (typeof value !== 'string') fail(field); return value; };
const array = (value, limit, field) => {
  if (!Array.isArray(value) || value.length > limit) fail(field);
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(field);
  return value;
};
const escape = value => {
  const source = String(value);
  return (source.length > LIMITS.text ? `${source.slice(0, LIMITS.text - 1)}…` : source)
    .replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, match => match.length === 1 ? '\ufffd' : match)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
// Match the HUD's whole-second tolerance for accumulated fixed-step times.
// This affects labels only; sample positions and exported data stay exact.
const displaySeconds = value => Math.floor(value + 1e-6);
const time = value => {
  const seconds = displaySeconds(value), hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60, remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(remainder).padStart(2, '0')}`;
};
const axisNumber = value => {
  if (value >= 1e9) return `${format(value / 1e9)}b`;
  if (value >= 1e6) return `${format(value / 1e6)}m`;
  if (value >= 1e3) return `${format(value / 1e3)}k`;
  return format(value);
};

function snapshot(value, field) {
  if (!object(value)) fail(field);
  number(value.time, `${field}.time`);
  if (array(value.sides, 2, `${field}.sides`).length !== 2) fail(`${field}.sides`);
  value.sides.forEach((side, index) => {
    if (!object(side) || side.side !== index) fail(`${field}.sides`);
    for (const key of ['gold', 'income', 'baseHp', 'baseMaxHp']) number(side[key], `${field}.${key}`);
    for (const key of ['armyCount', 'buildingCount']) integer(side[key], `${field}.${key}`);
  });
}

function validate(report) {
  if (!object(report) || report.format !== 'ironroot-battle-report' || report.version !== 1) fail('format');
  if (!object(report.context) || !object(report.map) || !object(report.outcome) || !object(report.scope) || !object(report.sampling) || !object(report.objectives)) fail('sections');
  text(report.context.name, 'context.name'); text(report.map.name, 'map.name'); text(report.outcome.label, 'outcome.label');
  if (!['victory', 'defeat', 'draw'].includes(report.outcome.result)) fail('outcome.result');
  for (const key of ['startedAt', 'endedAt', 'observedDuration', 'missingBefore']) number(report.scope[key], `scope.${key}`);
  if (typeof report.scope.resumed !== 'boolean' || typeof report.sampling.thinned !== 'boolean') fail('scope flags');
  if (report.scope.endedAt < report.scope.startedAt) fail('scope time order');
  for (const key of ['nominalInterval', 'currentInterval', 'retainedPoints', 'observationCount']) number(report.sampling[key], `sampling.${key}`);
  snapshot(report.initial, 'initial'); snapshot(report.final, 'final');
  const samples = array(report.timeline, LIMITS.samples, 'timeline');
  if (!samples.length || samples.length !== report.sampling.retainedPoints) fail('retained points');
  let previous = -1;
  samples.forEach((sample, index) => {
    snapshot(sample, `timeline[${index}]`);
    if (sample.time < previous) fail('timeline time order');
    previous = sample.time;
  });
  if (samples[0].time !== report.scope.startedAt || samples.at(-1).time !== report.scope.endedAt) fail('timeline coverage');
  if (report.initial.time !== report.scope.startedAt || report.final.time !== report.scope.endedAt) fail('snapshot coverage');
  if (array(report.cumulativeStats, 2, 'cumulativeStats').length !== 2) fail('cumulativeStats');
  report.cumulativeStats.forEach((side, index) => {
    if (!object(side) || side.side !== index) fail('cumulativeStats sides');
    for (const key of ['kills', 'built']) integer(side[key], `cumulativeStats.${key}`);
    number(side.damage, 'cumulativeStats.damage');
  });
  report.final.sides.forEach(side => {
    for (const key of ['unitComposition', 'buildingComposition']) {
      array(side[key], LIMITS.composition, key).forEach(item => {
        if (!object(item)) fail(key);
        text(item.name, `${key}.name`); text(item.type, `${key}.type`); integer(item.count, `${key}.count`);
      });
    }
  });
  array(report.objectives.items, LIMITS.objectives, 'objectives.items').forEach(item => {
    if (!object(item) || typeof item.met !== 'boolean' || typeof item.failed !== 'boolean') fail('objective');
    text(item.label, 'objective.label');
    if (item.text !== undefined && item.text !== null) text(item.text, 'objective.text');
  });
  array(report.objectives.targets, LIMITS.targets, 'objectives.targets').forEach(target => {
    if (!object(target) || !['protect', 'destroy'].includes(target.kind) || ![0, 1].includes(target.side) || typeof target.alive !== 'boolean') fail('objective target');
    text(target.name, 'target.name'); integer(target.lane, 'target.lane');
  });
  array(report.limitations, LIMITS.limitations, 'limitations').forEach(item => text(item, 'limitation'));
  return report;
}

function coverage(report) {
  const { scope, sampling } = report;
  const begin = scope.resumed ? 'Recording began when this battle was resumed on this page' : 'Recording began on this page';
  const before = scope.missingBefore > 0
    ? `Earlier play from 0:00 to ${time(scope.startedAt)} is not in these charts. Battle totals above still include that earlier play.`
    : 'The charts cover this page’s battle from its opening sample; they are not continuous tracking.';
  const thinning = sampling.thinned
    ? `The journal was thinned to ${format(sampling.retainedPoints)} retained samples from ${format(sampling.observationCount)} captured samples. Short peaks and changes may not appear in the charts.`
    : `${format(sampling.retainedPoints)} retained sample${sampling.retainedPoints === 1 ? '' : 's'}. Changes between samples may not appear.`;
  return `<aside class="report-scope" aria-label="Recording coverage"><strong>What this report covers</strong><p>${begin}, at ${time(scope.startedAt)}. Recording ends at ${time(scope.endedAt)}.</p><p>${before}</p><p>${thinning}</p></aside>`;
}

function totals(report) {
  const rows = [['kills', 'Units defeated'], ['built', 'Buildings placed'], ['damage', 'Damage dealt (HP)']];
  return `<section class="report-section"><h3>Battle totals</h3><table class="report-table"><caption>Both sides · the whole battle, including play before a resume</caption><thead><tr><th scope="col">Recorded total</th><th scope="col" class="report-side-label">You</th><th scope="col" class="report-side-label">Enemy</th></tr></thead><tbody>${rows.map(([key, label]) => `<tr><th scope="row">${label}</th>${report.cumulativeStats.map(side => `<td>${format(side[key])}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="report-note">Buildings placed includes buildings each side started with. Upgrades do not count as new placements.</p><p class="report-note">Damage dealt counts health removed from units, buildings and citadels by each side. Health that citadels lose automatically during overtime is not counted for either side.</p></section>`;
}

function lineChart(report, metric) {
  const samples = report.timeline;
  const values = [0, 1].map(side => samples.map(sample => sample.sides[side][metric.key]));
  const rawMax = Math.max(1, ...values.flat());
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const ceiling = [1, 2, 5, 10].find(step => step * magnitude >= rawMax) * magnitude;
  const first = samples[0].time, last = samples.at(-1).time, elapsed = last - first;
  const point = (value, index) => [elapsed ? 6 + (samples[index].time - first) / elapsed * 228 : 120, 110 - value / ceiling * 104];
  const lines = values.map((series, side) => {
    const points = series.map(point);
    const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const [x, y] = points.at(-1);
    const marker = side === 0 ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.3"/>` : `<path d="M ${x.toFixed(2)} ${(y - 4).toFixed(2)} l 4 4 -4 4 -4 -4 Z"/>`;
    return `<g class="report-line report-line-${side}"><path class="report-trace" d="${path}" fill="none" stroke="${side ? '#e9a48d' : '#d8c488'}" stroke-width="2.5"${side ? ' stroke-dasharray="7 5"' : ''}/>${marker}</g>`;
  }).join('');
  const summary = values.map((series, side) => `${SIDES[side]}: first ${format(series[0])}, last ${format(series.at(-1))}, retained-sample range ${format(Math.min(...series))} to ${format(Math.max(...series))} ${metric.unit}.`).join(' ');
  const description = `${metric.title}. ${metric.unit} on the vertical axis; elapsed battle time on the horizontal axis, ${time(first)} to ${time(last)}. Your series is a solid line with a circle; the enemy series is dashed with a diamond. ${summary}`;
  return `<figure class="report-chart"><figcaption><strong>${metric.title}</strong><span>${metric.unit}</span></figcaption><div class="report-chart-grid"><div class="report-y-axis" aria-hidden="true"><span>${axisNumber(ceiling)}</span><span>${axisNumber(ceiling / 2)}</span><span>0</span></div><svg class="report-graph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" preserveAspectRatio="none" role="img" aria-label="${escape(description)}" focusable="false"><title>${metric.title}</title><desc>${escape(description)}</desc><path class="report-gridline" d="M6 6 H234 M6 58 H234 M6 110 H234" fill="none"/>${lines}</svg><div class="report-x-axis" aria-hidden="true">${elapsed ? `<span>${time(first)}</span><span>${time(last)}</span>` : `<span>${time(first)} · one moment recorded</span>`}</div></div><p class="report-axis-label">Elapsed battle time · m:ss${displaySeconds(last) >= 3600 ? ' / h:mm:ss' : ''}</p><table class="report-chart-values report-table"><caption>${metric.title}: numeric chart summary (${metric.unit})</caption><thead><tr><th scope="col">Side</th><th scope="col">First</th><th scope="col">Last</th><th scope="col">Sample range</th></tr></thead><tbody>${values.map((series, side) => `<tr><th scope="row" class="report-side-label">${SIDES[side]}</th><td>${format(series[0])}</td><td>${format(series.at(-1))}</td><td>${format(Math.min(...series))}–${format(Math.max(...series))}</td></tr>`).join('')}</tbody></table><p class="report-note">${metric.detail}</p></figure>`;
}

function roster(report) {
  const units = new Map();
  for (const side of report.final.sides) for (const item of side.unitComposition) if (!units.has(item.type)) units.set(item.type, item.name);
  const rows = [...units].map(([type, name]) => `<tr><th scope="row">${escape(name)}</th>${report.final.sides.map(side => `<td>${format(side.unitComposition.find(item => item.type === type)?.count || 0)}</td>`).join('')}</tr>`).join('');
  return `<section class="report-section"><h3>At the final bell</h3><table class="report-table"><caption>Living unit roster at ${time(report.final.time)} · not total production</caption><thead><tr><th scope="col">Unit</th><th scope="col" class="report-side-label">You</th><th scope="col" class="report-side-label">Enemy</th></tr></thead><tbody>${rows}<tr class="report-total-row"><th scope="row">Living units</th>${report.final.sides.map(side => `<td>${format(side.armyCount)}</td>`).join('')}</tr><tr><th scope="row">Standing buildings</th>${report.final.sides.map(side => `<td>${format(side.buildingCount)}</td>`).join('')}</tr><tr><th scope="row">Citadel HP</th>${report.final.sides.map(side => `<td>${format(side.baseHp)}<small> / ${format(side.baseMaxHp)}</small></td>`).join('')}</tr></tbody></table></section>`;
}

function objectives(report) {
  const items = report.objectives.items.map(item => {
    const state = item.failed ? 'Failed' : item.met ? 'Met' : 'Not met';
    return `<li><span class="report-objective-state${item.met && !item.failed ? ' is-met' : ''}">${state}</span><div><strong>${escape(item.label)}</strong>${item.text ? `<p>${escape(item.text)}</p>` : ''}</div></li>`;
  }).join('');
  const targets = report.objectives.targets.map(target => {
    const label = `${target.kind === 'protect' ? 'Protect' : 'Destroy'}: ${target.name}`;
    return `<li><div><strong>${escape(label)}</strong><p>${SIDES[target.side]} · road ${format(target.lane + 1)} · ${target.alive ? 'Standing' : 'No longer standing'}</p></div></li>`;
  }).join('');
  return `<section class="report-section"><h3>Objective outcomes</h3><p class="report-objective-result">${escape(report.outcome.label)}</p>${items ? `<ul class="report-objective-list">${items}</ul>` : '<p class="report-note">No separate objective checks were recorded for this battle.</p>'}${targets ? `<details class="report-subdetails"><summary>Marked structure outcomes (${report.objectives.targets.length})</summary><ul class="report-objective-list">${targets}</ul></details>` : ''}</section>`;
}

function sampleTables(report) {
  return `<details class="report-subdetails report-samples"><summary>View retained sample data (${report.timeline.length})</summary><p class="report-note">The same retained points used by all four charts. Each side has its own table. Times use the battle clock’s whole-second display; values use at most two decimals. JSON keeps full precision. Tables scroll horizontally on small screens.</p>${[0, 1].map(side => `<div class="report-table-scroll" tabindex="0" role="region" aria-label="${SIDES[side]} retained samples, horizontally scrollable"><table class="report-table"><caption>${SIDES[side]} · retained samples</caption><thead><tr><th scope="col">Battle time</th><th scope="col">Gold</th><th scope="col">Gold / sec</th><th scope="col">Living units</th><th scope="col">Citadel HP</th></tr></thead><tbody>${report.timeline.map(sample => `<tr><th scope="row">${time(sample.time)}</th><td>${format(sample.sides[side].gold)}</td><td>${format(sample.sides[side].income)}</td><td>${format(sample.sides[side].armyCount)}</td><td>${format(sample.sides[side].baseHp)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</details>`;
}

/** One initially collapsed native disclosure. Mount inside the result dialog,
 * before an independently accessible action footer. Invalid reports throw.
 */
export function renderBattleReport(input) {
  const report = validate(input);
  const result = { victory: 'Victory', defeat: 'Defeat', draw: 'Draw' }[report.outcome.result];
  return `<details class="battle-report"><summary><span class="report-summary-title">Battle report</span><span class="report-summary-subtitle">Forces, economy &amp; objectives</span></summary><div class="report-body" role="region" aria-label="Battle report"><header class="report-header"><span class="report-kicker">FIELD RECORD</span><h3>${escape(report.context.name)}</h3><p>${escape(report.map.name)} <span aria-hidden="true">·</span> ${time(report.scope.endedAt)} battle time</p><span class="report-result">${result}</span></header>${totals(report)}${coverage(report)}<section class="report-section report-history"><h3>Recorded battle history</h3><p class="report-note">Snapshots of both sides, joined in time order. Lines connect recorded points; they do not reconstruct events between samples.</p><p class="report-legend"><span><i class="report-key report-key-you" aria-hidden="true"></i>You · solid / circle</span><span><i class="report-key report-key-enemy" aria-hidden="true"></i>Enemy · dashed / diamond</span></p>${METRICS.map(metric => lineChart(report, metric)).join('')}${sampleTables(report)}</section>${roster(report)}${objectives(report)}<div class="report-download"><p class="report-note">Available in this tab until a new battle or page reload. Not included in saved games, history or backups.</p><button type="button" data-report-download>Download report data (JSON)</button><p class="report-note">A local data record, not a playable replay.</p><p class="report-download-status" data-report-status role="status" aria-live="polite"></p></div>${report.limitations.length ? `<details class="report-subdetails report-limitations"><summary>About these records</summary><ul>${report.limitations.map(item => `<li>${escape(item)}</li>`).join('')}</ul></details>` : ''}</div></details>`;
}
