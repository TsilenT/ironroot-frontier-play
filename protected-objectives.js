import { BUILDINGS } from './engine.js';
import { getCampaignTargets } from './campaign.js';

// Presentation only. Original IDs and existence come from the campaign rules.
// No state writes, damage attribution, persistence, or outcome decisions here.
export const PROTECTED_CRITICAL_RATIO = 0.3;
const road = (lane, count) => count === 2 ? ['North', 'South'][lane]
  : count === 3 ? ['North', 'Middle', 'South'][lane] : `Road ${lane + 1}`;
export function protectedTargetLabels(targets, laneCount) {
  return targets.map(target => {
    if (typeof target.name === 'string' && target.name.trim()) {
      const label = `${target.name.trim()} · ${road(target.lane, laneCount)} road`;
      const duplicates = targets.filter(other => typeof other.name === 'string' && other.name.trim() === target.name.trim() && other.lane === target.lane);
      return duplicates.length > 1 ? `${label} · site ${target.x}` : label;
    }
    const label = `${road(target.lane, laneCount)} ${BUILDINGS[target.type].name.toLowerCase()}`;
    const duplicates = targets.filter(other => other.lane === target.lane && other.type === target.type);
    return duplicates.length > 1 ? `${label} · site ${target.x}` : label;
  });
}

// Resolve fresh authored original IDs at action time, not a previous UI frame.
// Invalid real mission identities deliberately propagate the campaign error.
export function isProtectedCampaignBuilding(game, missionId, buildingId) {
  if (!missionId) return null;
  return getCampaignTargets(game, missionId).some(target => target.kind === 'protect' && target.originalId === buildingId);
}

/** Current-page observations only; an initial absence cannot establish a death time. */
export function createProtectedObjectiveMonitor(game, missionId) {
  const initial = getCampaignTargets(game, missionId).filter(target => target.kind === 'protect');
  const labels = protectedTargetLabels(initial, game.map.lanes.length);
  const records = initial.map((target, index) => ({
    originalId: target.originalId, label: labels[index], seenAlive: false, loss: null,
  }));
  let snapshot = Object.freeze([]);
  function observe(current = game) {
    if (current !== game) throw new Error('Protected-objective observations belong to one battle.');
    const targets = getCampaignTargets(current, missionId).filter(target => target.kind === 'protect');
    snapshot = Object.freeze(targets.map((target, index) => {
      const record = records[index], building = target.building;
      if (record.originalId !== target.originalId) throw new Error('Protected objective identity changed.');
      if (!building && !record.loss) record.loss = Object.freeze({
        observedAt: Number.isFinite(current.state.time) ? current.state.time : null,
        observedTick: Number.isInteger(current.tick) ? current.tick : null,
        scope: record.seenAlive ? 'observed-transition' : 'already-missing',
      });
      if (building) record.seenAlive = true;
      const hp = building?.hp ?? null, maxHp = building?.maxHp ?? null;
      const ratio = building ? Math.max(0, Math.min(1, hp / maxHp)) : null;
      return Object.freeze({
        originalId: record.originalId, label: record.label, type: target.type,
        x: target.x, lane: target.lane, y: current.map.lanes[target.lane],
        hp, maxHp, ratio, percent: ratio === null ? null : Math.ceil(ratio * 100),
        status: !building ? 'lost' : ratio <= PROTECTED_CRITICAL_RATIO ? 'critical' : ratio < 1 ? 'damaged' : 'healthy',
        loss: record.loss,
      });
    }));
    return snapshot;
  }
  observe();
  return Object.freeze({ observe, read: () => snapshot });
}

// Hundredths retain the actual observed simulation step instead of inventing
// a previous whole-second loss timestamp. The raw tick/time stay in the record.
export function observedBattleTime(time) {
  if (!Number.isFinite(time) || time < 0) return 'an unknown battle time';
  const centiseconds = Math.round(time * 100);
  return `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}
export function protectedLossDetails(snapshot) {
  return snapshot.filter(target => target.loss).map(target => {
    const when = observedBattleTime(target.loss.observedAt);
    return target.loss.scope === 'already-missing'
      ? `${target.label}: original structure missing when this view began at ${when}. Loss time unknown.`
      : `${target.label}: original structure lost, first observed at ${when} battle time.`;
  });
}
