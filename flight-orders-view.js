import { supportsFlightOrders } from './flight-orders.js';
import { supportsAutonomousAir } from './autonomous-air.js';

/** Match the visual countdown; a pending warning never displays zero. */
export function flightWarningTime(remaining) {
  return Math.max(0.1, Math.ceil((remaining - 1e-8) * 10) / 10).toFixed(1);
}

// Presentation derives only from the retained battle. It never changes an order,
// advances the simulation, or reveals a producer's unlaunched enemy plan.
export function flightRoadName(map, lane) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= map.lanes.length) return 'Unknown road';
  const names = map.lanes.length === 3 ? ['North road', 'Middle road', 'South road']
    : map.lanes.length === 2 ? ['North road', 'South road'] : null;
  return names?.[lane] || (map.lanes.length === 1 ? 'Only road' : `Road ${lane + 1}`);
}

// All presentation is read-only, including battles retained under earlier rules.
export function airRulesGuide(context) {
  const ruleset = context?.ruleset || context;
  if (supportsAutonomousAir(ruleset)) return {
    title: 'Flying between roads',
    detail: 'Gryphons spot nearby enemies on their road or one road over and fly toward them automatically. Following fights can carry them farther across the field. Archers stay on their road; they and watchtowers can hit a flyer whenever it comes within range.',
  };
  return null;
}

export function airBuildingDescription(game, type) {
  const description = game.buildings[type]?.description || '';
  if (type !== 'aerie') return description;
  if (supportsAutonomousAir(game.ruleset)) return 'Spawns gryphons that fly toward nearby enemies on their road or one road over. Archers and towers counter them.';
  return description;
}

export function flightRouteRows(game) {
  if (!supportsFlightOrders(game.ruleset)) return [];
  const groups = new Map();
  for (const unit of game.state.units) {
    const route = unit.airRoute;
    if (unit.type !== 'gryphon' || unit.hp <= 0 || !route ||
        !['approach', 'warning', 'transit'].includes(route.phase)) continue;
    const key = `${unit.side}:${route.from}:${route.to}:${route.phase}`;
    let row = groups.get(key);
    if (!row) groups.set(key, row = {key, side: unit.side, from: route.from, to: route.to,
      phase: route.phase, count: 0, remaining: Infinity});
    row.count++;
    row.remaining = Math.min(row.remaining, route.remaining);
  }
  return [...groups.values()].sort((a, b) => a.side - b.side || a.from - b.from ||
    a.to - b.to || a.phase.localeCompare(b.phase)).map(row => ({...row,
      text: `${row.side ? 'Enemy' : 'Your'} ${row.count} ${row.count === 1 ? 'gryphon' : 'gryphons'}: ` +
        `${flightRoadName(game.map, row.from)} to ${flightRoadName(game.map, row.to)} · ` +
        (row.phase === 'approach' ? 'Approaching the crossing.' : row.phase === 'warning'
          ? `Next crossing starts in ${flightWarningTime(row.remaining)} seconds.` : 'Crossing now; cannot attack.'),
    }));
}

export function flightWarningSummary(game, units) {
  if (!supportsFlightOrders(game.ruleset)) return '';
  const destinations = [...new Set(units.filter(u => u.side === 1 && u.hp > 0 &&
    u.type === 'gryphon' && u.airRoute?.phase === 'warning').map(u => u.airRoute.to))];
  if (!destinations.length) return '';
  return `Enemy gryphons are about to cross toward the ${destinations.sort((a,b) => a-b)
    .map(lane => flightRoadName(game.map, lane).toLowerCase()).join(' and ')}, and your archers can hit them along the way.`;
}
