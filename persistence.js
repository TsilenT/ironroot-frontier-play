import { encodeBattle, scenarioForBattle, battleByteLength } from './battle-codec.js';
import { validateHistoryRow } from './history-codec.js';
/** Storage may be absent, denied or full. Never report an unwritten save as saved. */
export function createStorage(getBackend) {
  return {
    read(key) {
      try {
        return { ok: true, value: getBackend().getItem(key) };
      } catch {
        return { ok: false, value: null };
      }
    },
    get(key) {
      return this.read(key).value;
    },
    set(key, value) {
      try {
        getBackend().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        getBackend().removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
/** A failed read is not an empty domain. Keep its raw bytes out of UI/logs. */
function readValue(storage, key) {
  try {
    return storage.read ? storage.read(key) : { ok: true, value: storage.get(key) };
  } catch { return { ok: false, value: null }; }
}
export function readHistoryState(storage, key) {
  const read = readValue(storage, key);
  if (!read.ok) return { ok: false, reason: 'unavailable', rows: [], raw: null };
  try {
    const rows = read.value === null ? [] : JSON.parse(read.value);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
      throw Error('Malformed history');
    for (const row of rows) if (Object.hasOwn(row, 'identity')) validateHistoryRow(row);
    return { ok: true, reason: 'ready', rows: rows.slice(0, 30), raw: read.value };
  } catch { return { ok: false, reason: 'malformed', rows: [], raw: read.value }; }
}
// Legacy display-only normalization. Mutating callers must use readHistoryState.
export function readHistory(storage, key) {
  const read = readValue(storage, key);
  if (!read.ok) return [];
  try {
    const rows = JSON.parse(read.value || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).slice(0, 30) : [];
  } catch { return []; }
}
const resultKey = row => JSON.stringify([
  row.date, row.won, row.draw ?? false, row.challengeId ?? null,
  row.campaignId ?? null, row.difficulty, row.mapId ?? 'classic',
  row.time, row.kills, row.built, row.identity ?? null,
]);

/** Page-local outbox, using the existing history schema. Never substitute cached
 * history for an unreadable current value. Double reads and readback detect
 * observable races; LocalStorage has no atomic compare-and-swap across tabs.
 * The profile facade MUST remain the write boundary. No new storage keys.
 */
export function createHistorySession(storage, key, { canWrite = () => true } = {}) {
  let pending = [], latest = readHistoryState(storage, key), reason = 'ready';
  const allowed = () => { try { return canWrite(); } catch { return false; } };
  const merge = (rows, entries = pending) => {
    const existing = new Set(rows.map(resultKey));
    return [...entries.map(entry => entry.row).filter(row => !existing.has(resultKey(row))), ...rows].slice(0, 30);
  };
  return {
    read() {
      if (!allowed()) return { ok: false, reason: 'blocked', rows: [], raw: null };
      const current = readHistoryState(storage, key);
      if (current.ok) latest = current;
      return current;
    },
    snapshot: () => latest,
    pendingCount: () => pending.length,
    reason: () => reason,
    view: (rows = latest.rows) => merge(rows),
    retain(row, { ownership = () => 'current', onSaved = () => {} } = {}) {
      // JSON snapshots cannot be changed by a later battle or caller mutation.
      if (Object.hasOwn(row, 'identity')) validateHistoryRow(row);
      const copy = JSON.parse(JSON.stringify(row)), identity = resultKey(copy);
      if (!pending.some(entry => resultKey(entry.row) === identity)) pending.unshift({ row: copy, ownership, onSaved });
      pending = pending.slice(0, 30); // Same latest-30 policy as persisted history.
    },
    retry() {
      const fail = code => { reason = code; return false; };
      if (!pending.length) return true;
      if (!allowed()) return fail('blocked');
      let blocked = null;
      const ready = pending.filter(entry => {
        let state;
        try { state = entry.ownership(); } catch { state = 'unavailable'; }
        if (state !== 'current') { blocked = state === 'stale' ? 'battle-stale' : 'battle-unavailable'; return false; }
        return true;
      });
      if (!ready.length) return fail(blocked);
      const settled = () => {
        for (const entry of ready) { try { entry.onSaved(); } catch {} }
        pending = pending.filter(entry => !ready.includes(entry));
        reason = pending.length ? blocked : 'saved';
        return !pending.length;
      };
      const current = this.read();
      if (!current.ok) return fail(current.reason);
      const existing = new Set(current.rows.map(resultKey));
      const missing = ready.filter(entry => !existing.has(resultKey(entry.row)));
      if (!missing.length) {
        if (!allowed()) return fail('blocked');
        return settled();
      }
      const candidate = merge(current.rows, ready);
      try { for (const row of candidate) if (Object.hasOwn(row, 'identity')) validateHistoryRow(row); } catch { return fail('invalid-data'); }
      const desired = JSON.stringify(candidate);
      const checked = readValue(storage, key);
      if (!checked.ok) return fail('unavailable');
      if (checked.value !== current.raw) return fail('changed');
      if (!allowed()) return fail('blocked');
      // Even adapters that throw after writing can be verified without appending twice.
      const wrote = storage.set(key, desired), verified = this.read();
      if (!allowed()) return fail('blocked');
      if (!verified.ok) return fail(verified.reason);
      const saved = new Set(verified.rows.map(resultKey));
      if (ready.every(entry => saved.has(resultKey(entry.row)))) return settled();
      return fail(wrote ? 'changed' : 'write-failed');
    },
  };
}

/** Preferences apply to this page immediately. Retry only against the exact
 * settings snapshot this page loaded, never over a newer tab's preferences.
 */
export function createPreferenceSession(storage, key, { canWrite = () => true } = {}) {
  const initial = readValue(storage, key);
  let expected = initial.value, pending = null, reason = 'ready';
  const allowed = () => { try { return canWrite(); } catch { return false; } };
  return {
    initial: () => ({ ...initial }),
    dirty: () => pending !== null,
    reason: () => reason,
    stage(value) { pending = JSON.stringify(value); },
    retry() {
      const fail = code => { reason = code; return false; };
      if (pending === null) return true;
      if (!allowed()) return fail('blocked');
      if (!initial.ok) return fail('initial-unavailable');
      const current = readValue(storage, key);
      if (!current.ok) return fail('unavailable');
      if (current.value === pending) {
        if (!allowed()) return fail('blocked');
        expected = pending; pending = null; reason = 'saved'; return true;
      }
      if (current.value !== expected) return fail('changed');
      const checked = readValue(storage, key);
      if (!checked.ok) return fail('unavailable');
      if (checked.value !== expected) return fail('changed');
      if (!allowed()) return fail('blocked');
      const wrote = storage.set(key, pending), verified = readValue(storage, key);
      if (!allowed()) return fail('blocked');
      if (!verified.ok) return fail('unavailable');
      if (verified.value !== pending) return fail(wrote ? 'changed' : 'write-failed');
      expected = pending; pending = null; reason = 'saved'; return true;
    },
  };
}
const battleWriteFailures=new WeakMap();
export const getBattleWriteFailure=storage=>battleWriteFailures.get(storage)??null;
export function writeBattle(storage,key,game,challengeId=null,campaignId=null,options={}) {
  let value;
  try {
    value=JSON.stringify(encodeBattle(game,scenarioForBattle(challengeId,campaignId),options));
    battleByteLength(value);
  } catch(error) {
    battleWriteFailures.set(storage,{code:'invalid-battle',message:error.message||'This battle cannot be saved safely.'});
    return false;
  }
  try {
    const wrote=storage.set(key,value);
    const verified=storage.read?storage.read(key):typeof storage.get==='function'?{ok:true,value:storage.get(key)}:null;
    if(wrote!==true||(verified&&(!verified.ok||verified.value!==value)))throw new Error('The saved battle could not be verified.');
    battleWriteFailures.delete(storage);return true;
  } catch(error) {
    battleWriteFailures.set(storage,{code:'storage-unavailable',message:error.message||'The saved battle could not be verified.'});return false;
  }
}
export function nativeSpaceTarget(target) {
  return !!target?.closest?.(
    'button,input,select,textarea,a[href],summary,[contenteditable="true"]',
  );
}

/** Optimistic ownership protects a newer tab's battle from a stale tab's writes.
 * A deliberate new/resumed battle claims the current value; every write checks it.
 * Identical saves are a no-op, so hiding an already-paused tab does not rewrite it.
 */
export function createSaveSession(storage, key) {
  let expected = null,
    claimed = false,
    unavailableClaim = false;
  const read = () => {
    try {
      return storage.read
        ? storage.read(key)
        : { ok: true, value: storage.get(key) };
    } catch {
      return { ok: false, value: null };
    }
  };
  return {
    read(target) { return target===key?read():{ok:false,value:null}; },
    get(target) { return this.read(target).value; },
    claim() {
      const current = read();
      expected = current.value;
      claimed = current.ok;
      unavailableClaim = !current.ok;
      return current.ok;
    },
    status() {
      const current = read();
      if (!current.ok) return 'unavailable';
      // A game begun with storage denied may recover only into an empty slot.
      if (!claimed && unavailableClaim && current.value === null) {
        expected = null;
        claimed = true;
        unavailableClaim = false;
      }
      return claimed && current.value === expected ? 'current' : 'stale';
    },
    isCurrent() {
      return this.status() === 'current';
    },
    captureResult() {
      const captured = { expected, claimed, unavailableClaim };
      let authorization = null, removed = false;
      const status = () => {
        if (authorization) return authorization;
        const current = read();
        if (!current.ok) return 'unavailable';
        authorization = (captured.claimed && current.value === captured.expected) ||
          (!captured.claimed && captured.unavailableClaim && current.value === null)
          ? 'current' : 'stale';
        return authorization;
      };
      // Capture before deleting or starting a later battle. A valid completion
      // remains valid in this profile; the surrounding profile facade still fences it.
      status();
      return {
        status,
        remove() {
          if (removed) return true;
          if (status() !== 'current') return false;
          const current = read();
          if (!current.ok || current.value !== captured.expected) return false;
          if (current.value !== null && !storage.remove(key)) return false;
          removed = true;
          if (expected === captured.expected) expected = null;
          return true;
        },
      };
    },
    set(target, value) {
      if (target !== key || !this.isCurrent()) return false;
      if (value === expected) return true;
      try { storage.set(key, value); } catch { /* Readback verifies uncertain adapters. */ }
      const verified=read();
      if (!verified.ok || verified.value !== value) return false;
      expected = value;
      return true;
    },
    remove() {
      if (!this.isCurrent()) return false;
      if (expected === null) return true;
      if (!storage.remove(key)) return false;
      expected = null;
      return true;
    },
  };
}
