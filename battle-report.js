import { getMap, getRuleset } from './engine.js';
import { identityOf, scenarioForBattle, validateBattleIdentity } from './battle-codec.js';
import { supportsBridgeControl, bridgeIncome, BRIDGE_RULES_TEXT } from './bridge-control.js';

/** Read-only, current-session observations. This module never drives the game. */
const INTERVAL = 2;
const MAX_POINTS = 256;
const EPSILON = 1e-7;
const completedReports = new WeakSet();
const peakFields = ['gold', 'income', 'armyCount', 'buildingCount'];
const fail = message => { throw new TypeError(`Battle report: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function number(value, field, { max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) fail(`${field} must be a finite, nonnegative${integer ? ' integer' : ' number'} within range.`);
  return value;
}
function text(value, field, max = 500) {
  if (typeof value !== 'string' || value.length > max) fail(`${field} must be text of at most ${max} characters.`);
  return value;
}
function boolean(value, field) {
  if (typeof value !== 'boolean') fail(`${field} must be boolean.`);
  return value;
}
function array(value, field, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${field} must be an array of at most ${max} entries.`);
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail(`${field} must contain an own entry at every index.`);
  }
  return value;
}
function pair(value, field) {
  if (array(value, field, 2).length !== 2) fail(`${field} must have two sides.`);
  return value;
}
function side(value, field) {
  return number(value, field, { max: 1, integer: true });
}
function readTime(game) {
  if (!object(game) || !object(game.state)) fail('a game with state is required.');
  return number(game.state.time, 'simulation time');
}
function readMap(game) {
  if (!object(game.map)) fail('a battlefield descriptor is required.');
  const map = getMap(game.map.id, game.map.revision);
  if (game.map.revision !== map.revision) fail('unsupported battlefield revision.');
  return freeze({ id: map.id, revision: map.revision, name: map.name, width: map.width, height: map.height, lanes: [...map.lanes], laneCount: map.lanes.length });
}
function liveEntities(value, definitions, field, max) {
  return array(value, field, max).filter(entity => {
    if (!object(entity) || typeof entity.type !== 'string' || !Object.hasOwn(definitions, entity.type)) fail(`${field} contains an unknown entity.`);
    side(entity.side, `${field} side`);
    number(entity.hp, `${field} health`);
    if (field === 'buildings') {
      if (![1, 2, 3].includes(entity.level)) fail('building level must be 1, 2 or 3.');
    }
    return entity.hp > 0;
  });
}
function composition(entities, owner, types, definitions) {
  return types.map(type => ({ type, name: definitions[type].name, count: entities.filter(entity => entity.side === owner && entity.type === type).length }));
}
function snapshot(game, map, roster) {
  const { units: UNITS, buildings: BUILDINGS } = roster;
  const unitTypes = Object.keys(UNITS), buildingTypes = Object.keys(BUILDINGS);
  const time = readTime(game), state = game.state;
  if (game.map.id !== map.id || game.map.revision !== map.revision) fail('battlefield changed during recording.');
  const units = liveEntities(state.units, UNITS, 'units', 140);
  const buildings = liveEntities(state.buildings, BUILDINGS, 'buildings', map.laneCount * 16);
  const bases = pair(state.bases, 'bases'), gold = pair(state.gold, 'gold');
  return freeze({ time, sides: [0, 1].map(owner => {
    const base = bases[owner];
    if (!object(base) || base.side !== owner) fail('base sides do not match.');
    const baseMaxHp = number(base.maxHp, 'base maximum health');
    if (baseMaxHp === 0) fail('base maximum health must be positive.');
    const baseHp = number(base.hp, 'base health', { max: baseMaxHp });
    const ownBuildings = buildings.filter(building => building.side === owner);
    // Read the alive mines, not state.income: the latter can lag a build, sale,
    // upgrade or destruction until the next tick. This is a current rate only.
    const mineIncome = ownBuildings.filter(building => building.type === 'mint')
      .reduce((sum, building) => sum + BUILDINGS.mint.income * (1 + 0.5 * (building.level - 1)), 0);
    return {
      side: owner, label: owner === 0 ? 'You' : 'Enemy', gold: number(gold[owner], 'gold'),
      income: 5 + mineIncome + (supportsBridgeControl(roster)?bridgeIncome(game)[owner]:0), mineIncome,
      ...(supportsBridgeControl(roster)?{bridgeIncome:bridgeIncome(game)[owner]}:{}),
      armyCount: units.filter(unit => unit.side === owner).length,
      unitComposition: composition(units, owner, unitTypes, UNITS),
      buildingCount: ownBuildings.length,
      buildingComposition: composition(buildings, owner, buildingTypes, BUILDINGS),
      baseHp, baseMaxHp,
    };
  }) });
}
function cumulativeStats(game) {
  const stats = game.state.stats;
  if (!object(stats)) fail('engine counters are required.');
  for (const field of ['kills', 'built', 'damage']) pair(stats[field], field);
  return [0, 1].map(owner => ({
    side: owner,
    kills: number(stats.kills[owner], 'kills', { integer: true }),
    built: number(stats.built[owner], 'buildings placed', { integer: true }),
    damage: number(stats.damage[owner], 'damage'),
    ...(supportsBridgeControl(game.ruleset)?{bridgeGold:number(game.state.bridgeControl.earned[owner],'bridge gold')}:{}),
  }));
}
function readObjectives(objectiveOutcome, targets, map, BUILDINGS) {
  let items = [];
  if (objectiveOutcome !== null) {
    if (!object(objectiveOutcome)) fail('objective outcome must be an object.');
    boolean(objectiveOutcome.completed, 'objective completed');
    boolean(objectiveOutcome.failed, 'objective failed');
    if (objectiveOutcome.completed && objectiveOutcome.failed) fail('an objective cannot both complete and fail.');
    text(objectiveOutcome.label, 'objective outcome label');
    items = array(objectiveOutcome.objectives ?? [], 'objective items', 32).map(item => {
      if (!object(item)) fail('objective item must be an object.');
      return {
        id: text(item.id, 'objective id', 100), type: text(item.type, 'objective type', 100),
        label: text(item.label, 'objective label'), met: boolean(item.met, 'objective met'),
        failed: item.failed === undefined ? false : boolean(item.failed, 'objective failed'),
        progress: number(item.progress, 'objective progress', { max: 1 }),
        value: number(item.value, 'objective value'), target: number(item.target, 'objective target'),
        text: text(item.text, 'objective progress text'),
      };
    });
  }
  const copiedTargets = array(targets, 'resolved targets', 48).map(target => {
    if (!object(target) || !['protect', 'destroy'].includes(target.kind)) fail('target kind must be protect or destroy.');
    const owner = side(target.side, 'target side');
    if (typeof target.type !== 'string' || !Object.hasOwn(BUILDINGS, target.type)) fail('unknown target building.');
    const lane = number(target.lane, 'target lane', { max: map.laneCount - 1, integer: true });
    const x = number(target.x, 'target position', { max: map.width });
    if (target.building !== null && !object(target.building)) fail('resolved target must supply a building or null.');
    const building = target.building;
    if (building && (building.side !== owner || building.type !== target.type || building.lane !== lane || building.x !== x)) fail('resolved target does not match its location/type/side.');
    // Identity is resolved by the existing objective system, never by looking
    // for a replacement building at the same position in this observer.
    const alive = building !== null && number(building.hp, 'target health') > 0;
    return { kind: target.kind, side: owner, type: target.type, name: BUILDINGS[target.type].name, lane, x, alive };
  });
  return { items, targets: copiedTargets };
}
function outcomeFor(game, objectiveOutcome) {
  const engineWinner = game.state.winner;
  if (![null, 0, 1, 'draw'].includes(engineWinner)) fail('unknown engine winner.');
  const objectiveTerminal = objectiveOutcome !== null && (objectiveOutcome.completed || objectiveOutcome.failed);
  if (!objectiveTerminal && engineWinner === null) fail('a terminal engine or objective outcome is required.');
  return {
    result: objectiveTerminal ? (objectiveOutcome.completed ? 'victory' : 'defeat') : engineWinner === 'draw' ? 'draw' : engineWinner === 0 ? 'victory' : 'defeat',
    source: objectiveTerminal ? 'objective' : 'engine', engineWinner,
    objectiveCompleted: objectiveOutcome === null ? null : objectiveOutcome.completed,
    objectiveFailed: objectiveOutcome === null ? null : objectiveOutcome.failed,
    label: objectiveTerminal ? objectiveOutcome.label : engineWinner === 'draw' ? 'Both citadels fell.' : engineWinner === 0 ? 'Enemy citadel destroyed.' : 'Your citadel fell.',
  };
}

/**
 * Create after authored setup or restore. Sampling is driven explicitly by the
 * app, uses simulation time, and owns no engine references in returned data.
 * Call sample after advancement; finish forces an exact terminal snapshot.
 */
export function createBattleJournal(game, { resumed = false, mode = 'skirmish', id = null, name = 'Skirmish', identity: suppliedIdentity = null } = {}) {
  boolean(resumed, 'resumed flag');
  if (!['skirmish', 'campaign', 'challenge', 'trial', 'lesson'].includes(mode)) fail('unknown battle mode.');
  if (id !== null) text(id, 'battle id', 100);
  const context = freeze({ mode, id, name: text(name, 'battle name', 200) });
  const map = readMap(game);
  const roster = getRuleset(game.ruleset.id, game.ruleset.revision);
  if (game.units !== roster.units || game.buildings !== roster.buildings) fail('game definitions do not match its ruleset.');
  const identity = suppliedIdentity === null
    ? identityOf(game, mode === 'lesson' ? { kind: 'lesson', id, revision: 1 } : scenarioForBattle(['challenge', 'trial'].includes(mode) ? id : null, mode === 'campaign' ? id : null, game))
    : validateBattleIdentity(suppliedIdentity);
  if (identity.ruleset.id !== roster.id || identity.ruleset.revision !== roster.revision || identity.map.id !== map.id || identity.map.revision !== map.revision) fail('identity does not match the recorded game.');
  if (id !== null && (identity.scenario.id !== id || identity.scenario.kind !== (mode === 'challenge' ? 'trial' : mode))) fail('scenario identity does not match the recording context.');
  const rules = freeze({ name: roster.name, endgame: { ...roster.endgame },...(supportsBridgeControl(roster)?{bridgeControl:{...roster.economy}}:{}) });
  const initial = snapshot(game, map, roster);
  let timeline = [initial], interval = INTERVAL, thinningPasses = 0, observationCount = 1;
  let lastSeenTime = initial.time, finished = null;
  const observedPeaks = [0, 1].map(owner => ({ side: owner, ...Object.fromEntries(peakFields.map(field => [field, { value: initial.sides[owner][field], time: initial.time }])) }));
  const checkIdentity = current => {
    if (current !== game) fail('a journal belongs to one game; create a new journal after restore or restart.');
    if (current.ruleset !== roster || current.units !== roster.units || current.buildings !== roster.buildings) fail('ruleset changed during recording.');
  };
  const checkGame = current => {
    checkIdentity(current);
    const time = readTime(current);
    if (time < lastSeenTime) fail('simulation time moved backwards; start a new journal.');
    return time;
  };
  const accept = point => {
    observationCount++;
    for (const owner of [0, 1]) for (const field of peakFields) {
      if (point.sides[owner][field] > observedPeaks[owner][field].value) observedPeaks[owner][field] = { value: point.sides[owner][field], time: point.time };
    }
    if (point.time === timeline.at(-1).time) timeline[timeline.length - 1] = point;
    else timeline.push(point);
    if (timeline.length > MAX_POINTS) {
      // Keep actual first/every-second/final observations, never interpolate.
      timeline = timeline.filter((_, index) => index % 2 === 0 || index === timeline.length - 1);
      interval *= 2;
      thinningPasses++;
    }
    lastSeenTime = point.time;
  };
  return Object.freeze({
    sample(current = game) {
      checkIdentity(current);
      if (finished) return false;
      const time = checkGame(current);
      if (time === timeline.at(-1).time || time - timeline.at(-1).time + EPSILON < interval) {
        lastSeenTime = time;
        return false;
      }
      accept(snapshot(current, map, roster));
      return true;
    },
    finish(current = game, { objectiveOutcome = null, targets = [] } = {}) {
      checkIdentity(current);
      if (finished) return finished;
      checkGame(current);
      // Validate everything before altering journal state. No supplied object,
      // entity, function, extra field or prototype is copied into the report.
      const objectives = readObjectives(objectiveOutcome, targets, map, roster.buildings);
      const outcome = outcomeFor(current, objectiveOutcome);
      const counters = cumulativeStats(current), final = snapshot(current, map, roster);
      if (JSON.stringify(final) !== JSON.stringify(timeline.at(-1))) accept(final);
      const fullTimeline = !resumed && initial.time === 0;
      const limitations = [
        'Timeline values are snapshots at observed simulation times, not continuous measurements. No interpolation or causal explanation is recorded.',
        'Observed peaks use captured snapshots, including snapshots later removed by thinning; events between observations may be missed.',
        supportsBridgeControl(roster)
          ? 'Income is the current rate from base income, living mines and owned uncontested bridges. Bridge gold is an exact full-match engine counter; other gold changes do not establish spending, refunds or earnings. '+BRIDGE_RULES_TEXT
          : 'Income is the current rate from base income and living mines, not gold received. Gold changes do not establish spending, refunds, or earned income.',
        'Army and building compositions show living entities at each observation, not lifetime production.',
        'Cumulative kills, buildings placed, and damage are existing full-match engine counters, including before Resume. Buildings placed include starting allocations; upgrades are not additional placements.',
        roster.endgame.forcedDecay
          ? 'Damage is engine-credited damage to units and structures; automatic overtime citadel decay is not credited to either side.'
          : 'Damage is engine-credited damage to units and structures. This ruleset has no automatic citadel decay.',
        'This report is held only in this tab for the current match. It is not included in saves, history, or backups.',
      ];
      if (!fullTimeline) limitations.unshift(`Timeline recording began at simulation time ${initial.time} seconds${resumed ? ' after Resume' : ''}. Earlier timeline observations are unavailable.`);
      if (thinningPasses) limitations.push('Older timeline observations were thinned to keep at most 256 points; the recording interval increased. Retained points keep their actual observation times.');
      finished = freeze({
        format: 'ironroot-battle-report', version: 2, identity, rules, context, map, outcome,
        scope: { resumed, startedAt: initial.time, endedAt: final.time, observedDuration: final.time - initial.time, missingBefore: initial.time, fullTimeline, counters: 'full-match-engine' },
        sampling: { nominalInterval: INTERVAL, currentInterval: interval, maximumPoints: MAX_POINTS, observationCount, retainedPoints: timeline.length, thinned: thinningPasses > 0, thinningPasses, interpolated: false },
        initial, final, timeline: [...timeline], observedPeaks, cumulativeStats: counters, objectives, limitations,
      });
      completedReports.add(finished);
      return finished;
    },
  });
}

/** Local export only, no storage or download side effect. No arbitrary objects. */
export function exportBattleReport(report) {
  if (!object(report) || !completedReports.has(report)) fail('export requires a completed report from this session.');
  return JSON.stringify(report, null, 2);
}
