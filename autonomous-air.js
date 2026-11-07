/** DOM-free local air perception. No orders, birth-road leash, gates or random draws. */
import { RULESETS } from './rulesets.js';

export function supportsAutonomousAir(ruleset) {
  return !!ruleset && RULESETS[ruleset.id] === ruleset && ruleset.movement.policy === 'autonomous-air-local-v1';
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nearestRoad = (map, y) => map.lanes.reduce((best, road, i) =>
  Math.abs(road - y) < Math.abs(map.lanes[best] - y) ? i : best, 0);
function eligible(game, unit, enemy) {
  if (!enemy || enemy.hp <= 0 || enemy.side === unit.side) return false;
  const definition = game.units[unit.type], enemyDefinition = game.units[enemy.type];
  if (!enemyDefinition || !(enemyDefinition.flying ? definition.canAttackAir : definition.canAttackGround)) return false;
  // Sight follows the roads physically nearby, not a producer or birth road.
  // A legitimate in-range opponent never gains immunity from lane bookkeeping.
  return Math.abs(nearestRoad(game.map, enemy.y) - unit.lane) <= 1 || distance(unit, enemy) <= definition.range;
}
export function releaseAirTarget(unit) { unit.airTargetId = null; }
export function retainedAirTarget(game, unit, byId) {
  const target = byId.get(unit.airTargetId);
  return eligible(game, unit, target) && distance(unit, target) <= game.ruleset.movement.autonomousAir.retention ? target : null;
}
export function autonomousAirTarget(game, unit, byId) {
  const retained = retainedAirTarget(game, unit, byId);
  if (retained) return retained; // Nearer distractions do not steal a living lock.
  let best = null, bestDistance = game.ruleset.movement.autonomousAir.perception;
  for (const target of game.state.units) {
    if (!eligible(game, unit, target)) continue;
    const candidateDistance = distance(unit, target);
    if (candidateDistance < bestDistance ||
        (candidateDistance === bestDistance && (!best || target.id < best.id))) {
      best = target;
      bestDistance = candidateDistance;
    }
  }
  unit.airTargetId = best?.id ?? null;
  return best;
}
