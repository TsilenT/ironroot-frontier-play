import { signalProtectionRules } from './campaign-presentation.js';
import { supportsCampaignControl, bridgeZones } from './bridge-control.js';
import { buildBounds, getMap } from './engine.js';

import { getRuleset } from './rulesets.js';

/** Read-only briefings from authored deployments, never from a running battle. */
const LEGEND = 'Squares: your army on the left. Diamonds: enemy army on the right. Shield outline: protect. Dashed ring: destroy.';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = ({ type, x, lane }) => `${type}/${x}/${lane}`;
const roadName = (lane, count) => count === 3 ? ['North road', 'Middle road', 'South road'][lane] : count === 2 ? ['North road', 'South road'][lane] : `Road ${lane + 1}`;
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Escape at the markup boundary, including XML-invalid control characters.
const escape = value => String(value)
  .replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, match => match.length === 1 ? '\ufffd' : match)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function list(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`Scouting ${field} must be an array.`);
  return value;
}

function location(type, x, lane, map, field, buildings) {
  if (typeof type !== 'string' || !Object.hasOwn(buildings, type)) throw new TypeError(`Scouting ${field} has an unknown building type.`);
  if (!Number.isFinite(x) || x < 0 || x > map.width) throw new RangeError(`Scouting ${field} has an invalid world position.`);
  if (!Number.isInteger(lane) || lane < 0 || lane >= map.lanes.length) throw new RangeError(`Scouting ${field} has an invalid road.`);
}

function placements(value, side, map, field, definitions) {
  const rosterOrder = Object.keys(definitions);
  const occupied = new Set();
  return Array.from(list(value, field), (tuple, index) => {
    if (!Array.isArray(tuple) || tuple.length < 3 || tuple.length > 4) throw new TypeError(`Scouting ${field}[${index}] must be [type, x, lane, level?].`);
    const [type, x, lane, level = 1] = tuple;
    location(type, x, lane, map, field, definitions);
    if (!Number.isInteger(level) || level < 1 || level > 3) throw new RangeError(`Scouting ${field} has an invalid building level.`);
    const position = `${x}/${lane}`;
    if (occupied.has(position)) throw new RangeError(`Scouting ${field} repeats a building position.`);
    occupied.add(position);
    return { type, name: definitions[type].name, side, x, y: map.lanes[lane], lane, roadName: roadName(lane, map.lanes.length), level, targetKind: null };
  }).sort((a, b) => a.lane - b.lane || a.x - b.x || rosterOrder.indexOf(a.type) - rosterOrder.indexOf(b.type));
}

function markTargets(value, buildings, kind, map, field, definitions) {
  const targets = new Set();
  for (const target of list(value, field)) {
    if (!object(target)) throw new TypeError(`Scouting ${field} must contain target objects.`);
    location(target.type, target.x, target.lane, map, field, definitions);
    const building = buildings.find(candidate => key(candidate) === key(target));
    if (!building) throw new RangeError(`Scouting ${field} does not match a starting ${kind === 'protect' ? 'allied' : 'enemy'} building.`);
    building.targetKind = kind;
    if (typeof target.name === 'string' && target.name) building.targetName = target.name;
    targets.add(key(target));
  }
  return targets.size;
}

function groupsFor(buildings, definitions) {
  const rosterOrder = Object.keys(definitions);
  return rosterOrder.flatMap(type => {
    const own = buildings.filter(building => building.type === type);
    if (!own.length) return [];
    return [{ type, name: definitions[type].name, count: own.length, levels: [1, 2, 3].flatMap(level => {
      const count = own.filter(building => building.level === level).length;
      return count ? [{ level, count }] : [];
    }) }];
  });
}

const groupText = group => `${group.count} × ${group.name} (${group.levels.length === 1 ? `level ${group.levels[0].level}` : group.levels.map(({ level, count }) => `${count} at level ${level}`).join(', ')})`;

function armyFor(buildings, side, map, definitions) {
  const rosterOrder = Object.keys(definitions);
  const groups = groupsFor(buildings, definitions);
  const roads = map.lanes.map((y, lane) => {
    const own = buildings.filter(building => building.lane === lane);
    const items = rosterOrder.flatMap(type => [1, 2, 3].flatMap(level => [null, 'protect', 'destroy'].flatMap(targetKind => {
      const count = own.filter(building => building.type === type && building.level === level && building.targetKind === targetKind).length;
      return count ? [`${count} × ${definitions[type].name} (level ${level}${targetKind ? `, ${targetKind}` : ''})`] : [];
    })));
    const names = own.filter(building => building.targetName).map(building => `${building.targetName}: ${building.name}`).join('; ');
    return { lane, y, name: roadName(lane, map.lanes.length), count: own.length, summary: (items.length ? `${items.join('; ')}.` : 'No starting buildings.') + (names ? ` Named positions — ${names}.` : '') };
  });
  return {
    side, position: side === 0 ? 'left' : 'right', label: side === 0 ? 'Your army · left' : 'Enemy army · right',
    shape: side === 0 ? 'square' : 'diamond', buildingCount: buildings.length, buildings, groups, roads,
    summary: groups.length ? `${groups.map(groupText).join('; ')}.` : 'No starting buildings.',
  };
}

/**
 * Return a deeply frozen report. Omitted arrays mean empty deployments/targets;
 * omitted mapId means Classic. Other malformed data throws, rather than showing
 * a plausible but false briefing. Raw report strings are TEXT, not safe HTML.
 */
export function getMissionScouting(mission, context = null) {
  if (!object(mission)) throw new TypeError('Scouting requires a mission object.');
  if (mission.name !== undefined && typeof mission.name !== 'string') throw new TypeError('Scouting mission name must be text.');
  const suppliedRuleset = context?.ruleset || context;
  const ruleset = suppliedRuleset ? getRuleset(suppliedRuleset.id, suppliedRuleset.revision) : getRuleset(mission.rulesetId, mission.rulesetRevision);
  if (mission.rulesetId !== undefined && (mission.rulesetId !== ruleset.id || (mission.rulesetRevision ?? 1) !== ruleset.revision)) throw new TypeError('Scouting ruleset does not match the mission.');
  const definitions = ruleset.buildings;
  const sourceMap = getMap(mission.mapId, mission.mapRevision);
  const left = placements(mission.playerBuildings, 0, sourceMap, 'playerBuildings', definitions);
  const right = placements(mission.enemyBuildings, 1, sourceMap, 'enemyBuildings', definitions);
  const protectedCount = markTargets(mission.protectedTargets, left, 'protect', sourceMap, 'protectedTargets', definitions);
  const markedCount = markTargets(mission.markedTargets, right, 'destroy', sourceMap, 'markedTargets', definitions);
  const map = {
    id: sourceMap.id, name: sourceMap.name, width: sourceMap.width, height: sourceMap.height,
    lanes: [...sourceMap.lanes], roadCount: sourceMap.lanes.length, siteLimit: sourceMap.buildLimit,
    placement: sourceMap.id === 'classic' ? 'Free placement within your territory' : 'Marked building sites',
    territories: [0, 1].map(side => ({ side, ...buildBounds(sourceMap, side) })),
    summary: `${sourceMap.name} · ${sourceMap.width} × ${sourceMap.height} world units · ${sourceMap.lanes.length} roads · ${sourceMap.buildLimit}-building limit per side`,
  };
  const armies = [armyFor(left, 0, sourceMap, definitions), armyFor(right, 1, sourceMap, definitions)];
  const required = mission.requiredTargets;
  if (required !== undefined && (!Number.isInteger(required) || required < 1 || required > markedCount)) throw new RangeError('Scouting has an invalid required target count.');
  const control = supportsCampaignControl(ruleset) ? ruleset.campaignControl : null;
  const signals = signalProtectionRules(mission);
  const evacuationTime = signals ? `${Math.floor(signals.seconds / 60)}:${String(signals.seconds % 60).padStart(2, '0')}` : '';
  const objectives = {
    protectedCount, markedCount,
    ...(control ? {control:{seconds:control.seconds,bridges:control.requiredBridges,zones:bridgeZones(sourceMap)}} : {}),
    summary: signals ? `Keep at least 1 of 2 original signals until ${evacuationTime}, or destroy the enemy citadel with a signal still alive. Either signal may fall to enemy attacks, but losing the last fails the mission. Signals cannot be salvaged; replacements do not count. Keeping both earns an optional medal.` : control ? `Secure any ${control.requiredBridges} of ${sourceMap.lanes.length} central crossings for ${control.seconds} cumulative seconds. Contested progress pauses without resetting. No bridge gold bonus. Destroying the enemy citadel also wins.` : required !== undefined ? `Destroy any ${required} of ${markedCount} named enemy positions; the others may remain standing.` : `${protectedCount} allied structure${protectedCount === 1 ? '' : 's'} to protect; ${markedCount} enemy destruction target${markedCount === 1 ? '' : 's'}.`,
  };
  return freeze({
    missionName: mission.name || 'Mission', map, armies, objectives, legend: LEGEND + (control ? ' Outlined rectangles at the river mark the three capture zones.' : ''),
    summary: `${map.summary}. Your army starts on the left with ${left.length} building${left.length === 1 ? '' : 's'}; the enemy starts on the right with ${right.length}. ${objectives.summary}`,
  });
}

function svgFor(report) {
  const { map } = report;
  const title = `${report.missionName}: starting deployment`;
  const description = `${report.summary} North is at the top. ${report.legend} Symbols show starting positions and are enlarged for readability. Building names, levels and roads are listed below the map.`;
  const territories = map.territories.map(bounds => `<rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.maxX - bounds.minX}" height="${bounds.maxY - bounds.minY}" rx="45" fill="${bounds.side === 0 ? '#9abc86' : '#d9856f'}" fill-opacity=".07"/>`).join('');
  const roads = map.lanes.map((y, lane) => `<g class="scouting-road" data-lane="${lane}"><path d="M 0 ${y} H ${map.width}" stroke="#666e5e" stroke-width="32"/><path d="M 0 ${y} H ${map.width}" stroke="#9fae9c" stroke-opacity=".65" stroke-width="4" stroke-dasharray="20 28"/></g>`).join('');
  const crossings = (report.objectives.control?.zones || []).map(zone => `<rect class="scouting-crossing" x="${zone.x-zone.width/2}" y="${zone.y-zone.height/2}" width="${zone.width}" height="${zone.height}" fill="#e6c56f" fill-opacity=".2" stroke="#e6c56f" stroke-width="12"/>`).join('');
  const buildings = report.armies.flatMap(army => army.buildings.map(building => {
    const glyph = army.side === 0
      ? '<rect class="scouting-friendly" x="-29" y="-29" width="58" height="58" rx="5" fill="#9abc86" stroke="#eee9d9" stroke-width="7"/>'
      : '<path class="scouting-enemy" d="M 0 -39 L 39 0 L 0 39 L -39 0 Z" fill="#d9856f" stroke="#eee9d9" stroke-width="7"/>';
    const objective = building.targetKind === 'protect'
      ? '<path class="scouting-protect" d="M -54 -51 L 54 -51 L 54 7 Q 54 38 0 65 Q -54 38 -54 7 Z" fill="none" stroke="#e6c56f" stroke-width="10"/>'
      : building.targetKind === 'destroy'
        ? '<circle class="scouting-destroy" r="56" fill="none" stroke="#eee9d9" stroke-width="9" stroke-dasharray="15 9"/>' : '';
    const label = `${building.targetName ? building.targetName + ': ' : ''}${army.side === 0 ? 'Allied' : 'Enemy'} ${building.name}, level ${building.level}, ${building.roadName}${building.targetKind ? `, ${building.targetKind}` : ''}`;
    return `<g class="scouting-building" data-side="${army.side}" data-lane="${building.lane}" data-kind="${building.targetKind || 'ordinary'}" transform="translate(${building.x} ${building.y})"><title>${escape(label)}</title>${objective}${glyph}</g>`;
  })).join('');
  // No IDs, event handlers, external resources, animation, or dynamic CSS.
  // The real world viewBox preserves both map width and vertical road spacing.
  return `<svg class="scouting-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.width} ${map.height}" width="${map.width}" height="${map.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escape(`${title}. ${description}`)}" focusable="false" style="display:block;width:100%;height:auto"><title>${escape(title)}</title><desc>${escape(description)}</desc><g aria-hidden="true"><rect width="${map.width}" height="${map.height}" rx="45" fill="#101916"/>${territories}${roads}<path d="M ${map.width / 2} 140 V ${map.height - 140}" stroke="#9fae9c" stroke-opacity=".45" stroke-width="5" stroke-dasharray="16 20"/>${crossings}${buildings}</g></svg>`;
}

/** Standalone safe SVG. Accepts a mission, not an unchecked report or HTML. */
export function renderScoutingSvg(mission, context = null) {
  return svgFor(getMissionScouting(mission, context));
}

/**
 * Safe HTML body for the parent's collapsed <details>. All interpolated text
 * is escaped. This helper neither mounts DOM nor adds controls or a disclosure.
 */
export function renderMissionScouting(mission, context = null) {
  const report = getMissionScouting(mission, context);
  const armies = report.armies.map(army => `<section class="scouting-army scouting-army-${army.position}" aria-label="${escape(army.label)}"><p class="scouting-army-title"><strong>${escape(army.label)}</strong> · ${army.buildingCount} starting building${army.buildingCount === 1 ? '' : 's'}</p><p class="scouting-roster">${escape(army.summary)}</p><ul class="scouting-roads">${army.roads.map(road => `<li><strong>${escape(road.name)}:</strong> ${escape(road.summary)}</li>`).join('')}</ul></section>`).join('');
  return `<div class="mission-scouting"><p class="scouting-map-facts">${escape(report.map.summary)}.</p>${svgFor(report)}<p class="scouting-legend">${escape(report.legend)}</p><p class="scouting-objectives">${escape(report.objectives.summary)}</p><div class="scouting-armies">${armies}</div><p class="scouting-note">Shows starting buildings. Symbols are enlarged for readability. The map does not predict how the battle will unfold.</p></div>`;
}
