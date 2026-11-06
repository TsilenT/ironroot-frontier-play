import { PROTECTED_CRITICAL_RATIO } from './protected-objectives.js';

// Presentation-only, current-page policy. No engine, storage, timers or audio
// writes: the caller observes immutable monitor snapshots and delivers cues.
export const OBJECTIVE_ALERT_RECOVERY_RATIO = 0.4;
export const OBJECTIVE_WARNING_QUIET_SECONDS = 6;
const liveStatuses = new Set(['healthy', 'damaged', 'critical']);
const validId = id => typeof id === 'string' && id.length > 0 ||
  Number.isSafeInteger(id) && id >= 0;

/**
 * Bind to an opaque battle identity (the protected monitor is suitable) and its
 * exact original IDs. Make a NEW policy for every start/retry/restore, even when
 * IDs repeat. Identity changes, result, stale profile and close are terminal.
 *
 * observe queues actual observations; flush is the only delivery boundary.
 * Keep observing before checking pause so a pending transition is not lost.
 */
export function createObjectiveAlertPolicy({ battleKey, targetIds } = {}) {
  if (battleKey === undefined || battleKey === null || !Array.isArray(targetIds) ||
      targetIds.some(id => !validId(id)) || new Set(targetIds).size !== targetIds.length)
    throw new TypeError('A battle identity and unique original target IDs are required.');
  const records = new Map(targetIds.map(id => [id, {
    seen: false, lost: false, announced: false, pending: null, lastHp: null, target: null,
  }]));
  let closed = false, lastSoundAt = -Infinity;

  function close() {
    closed = true;
    for (const record of records.values()) { record.pending = null; record.target = null; }
  }

  function observe(snapshot, { battleKey: currentKey } = {}) {
    if (closed) return false;
    if (currentKey !== battleKey) { close(); return false; }
    // Fail closed rather than carry warnings across missing/replaced originals.
    // Validate the entire batch before recording any part of it.
    if (!Array.isArray(snapshot) || snapshot.length !== records.size ||
        new Set(snapshot.map(target => target?.originalId)).size !== records.size ||
        snapshot.some(target => !target || !records.has(target.originalId) ||
          typeof target.label !== 'string' || !target.label.trim() ||
          target.status !== 'lost' && (!liveStatuses.has(target.status) ||
            !Number.isFinite(target.hp) || target.hp <= 0 ||
            !Number.isFinite(target.maxHp) || target.maxHp <= 0))) {
      close();
      return false;
    }
    for (const target of snapshot) {
      const record = records.get(target.originalId);
      // Loss is final for an original; rebuilding at its site cannot rearm it.
      if (record.lost || target.status === 'lost' || target.loss != null) {
        record.lost = true;
        record.pending = null;
        record.target = null;
        continue;
      }
      const ratio = Math.min(1, target.hp / target.maxHp);
      // Use exact HP, never the rounded percentage. Both the monitor's status
      // and HP must support a critical warning; inconsistent data stays quiet.
      const critical = target.status === 'critical' && ratio <= PROTECTED_CRITICAL_RATIO;
      if (ratio > OBJECTIVE_ALERT_RECOVERY_RATIO) record.announced = false;
      if (!critical) record.pending = null;
      else if (!record.announced && !record.pending &&
          (!record.seen || target.hp < record.lastHp))
        record.pending = record.seen ? 'health-decreased' : 'current-danger';
      record.target = Object.freeze({
        originalId: target.originalId, label: target.label,
        hp: target.hp, maxHp: target.maxHp, ratio, percent: Math.ceil(ratio * 100),
      });
      record.seen = true;
      record.lastHp = target.hp;
    }
    return true;
  }

  function flush({ battleKey: currentKey, active = false, ended = false, stale = false, now } = {}) {
    if (closed) return null;
    if (currentKey !== battleKey) { close(); return null; }
    if (ended || stale) { close(); return null; }
    // Paused/help/settings/hidden/safety-blocked delivery must not consume a
    // pending episode. Resume only warns if it is still currently critical.
    if (!active) return null;
    if (!Number.isFinite(now) || now < 0)
      throw new TypeError('Active alert delivery requires monotonic seconds.');
    const targets = [];
    for (const record of records.values()) {
      if (!record.pending) continue;
      targets.push(Object.freeze({ ...record.target, reason: record.pending }));
      record.pending = null;
      record.announced = true;
    }
    if (!targets.length) return null;
    // Suppress sound for closely spaced *new* episodes, but still supply their
    // current named danger text. There is no cooldown-triggered replay/backlog.
    const sound = now - lastSoundAt >= OBJECTIVE_WARNING_QUIET_SECONDS ? 'warning' : null;
    if (sound) lastSoundAt = now;
    return Object.freeze({
      kind: 'critical-danger',
      targets: Object.freeze(targets),
      message: `Critical health: ${targets.map(target => `${target.label} (${target.percent}% HP)`).join(', ')}.`,
      sound,
    });
  }

  return Object.freeze({ observe, flush, close });
}
