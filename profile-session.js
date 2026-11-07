/** Optimistic cross-tab import barrier. LocalStorage is not an atomic transaction. */
export const CURRENT_PROFILE_PROTOCOL_VERSION = 11;
export const PROFILE_MARKER_KEY = 'ironroot.profile.v1';
const FORMAT = 'ironroot-profile';
const PHASES = ['ready', 'restoring', 'failed'];
const IMPORT_KEYS = new Set(['ironroot.campaign.v1', 'ironroot.trials.v1', 'ironroot.settings.v1', 'ironroot.history.v1', 'ironroot.battle.v1']);
let counter = 0;
function nextEpoch() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export class ProfileSessionError extends Error {
  constructor(code, message) { super(message); this.name = 'ProfileSessionError'; this.code = code; }
}
function error(code, message) { throw new ProfileSessionError(code, message); }
function marker(raw, requiredProtocolVersion) {
  if (raw === null) return { raw, version: 0, phase: 'ready', epoch: null };
  if (typeof raw !== 'string' || raw.length > 512) error('invalid-marker', 'The profile marker is invalid. Keep other Ironroot tabs closed and recover from a backup.');
  let value;
  try { value = JSON.parse(raw); } catch { error('invalid-marker', 'The profile marker is unreadable. Keep other Ironroot tabs closed and recover from a backup.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 4 || !['format','version','epoch','phase'].every(k => Object.hasOwn(value,k)) ||
      value.format !== FORMAT || !Number.isInteger(value.version) || value.version < 1 || value.version > requiredProtocolVersion || !PHASES.includes(value.phase) ||
      typeof value.epoch !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.epoch))
    error('invalid-marker', 'The profile marker is invalid or incompatible. Keep other Ironroot tabs closed and recover from a backup.');
  return { raw, version: value.version, phase: value.phase, epoch: value.epoch };
}
function encoded(epoch, phase, version) { return JSON.stringify({ format: FORMAT, version, epoch, phase }); }

/**
 * getBackend must expose throwing getItem/setItem/removeItem methods, never swallow read errors.
 * Protocol 2 fences expanded campaigns; protocol 3 fences explicit battle identities; protocol 4 fences earned campaign rosters; protocol 5 fences flight orders and campaign revision 3; protocol 6 fences automatic adjacent-road flyers and campaign revision 4; protocol 7 fences keyboard preferences from clients that reconstruct only the older fields; protocol 8 fences the expanded field-trial catalog from clients that discard unknown records; protocol 9 fences the optional Skirmish bridge preference and result identities from older writers; protocol 10 fences citadel campaign, field-trial and Skirmish result identities from older writers; protocol 11 fences immediate citadel purchases from writers that require the old 90-second wait.
 * Only construction upgrades a ready marker; a failed or uncertain upgrade requires reload.
 */
export function createProfileSession(getBackend, { newEpoch = nextEpoch, requiredProtocolVersion = 1 } = {}) {
  if (typeof getBackend !== 'function' || typeof newEpoch !== 'function') throw new TypeError('A storage getter and epoch factory are required.');
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(requiredProtocolVersion)) throw new TypeError('The required profile protocol must be version 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 or 11.');
  let boundRaw, boundKnown = false, initiallyUnavailable = false, transaction = null, upgradeAttempted = false, upgradeError = null;
  function backend() {
    let value;
    try { value = getBackend(); }
    catch { error('storage-unavailable', 'Browser storage is unavailable. Your running game can remain open, but no import or save was completed.'); }
    if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function' || typeof value.removeItem !== 'function')
      error('storage-unavailable', 'A reliable browser storage connection is required.');
    return value;
  }
  function rawRead() {
    try {
      const raw = backend().getItem(PROFILE_MARKER_KEY);
      if (raw !== null && typeof raw !== 'string') throw new Error('Invalid storage read');
      return raw;
    }
    catch (e) {
      if (e instanceof ProfileSessionError) throw e;
      error('marker-read-failed', 'The profile marker cannot be read. Keep this page open; saving and importing are blocked until storage is available.');
    }
  }
  function read() { return marker(rawRead(), requiredProtocolVersion); }
  function needsUpgrade(current) { return requiredProtocolVersion > 1 && current.version < requiredProtocolVersion; }
  try {
    let initial = read();
    if (initial.phase === 'ready' && needsUpgrade(initial)) {
      upgradeAttempted = true;
      // A ready v1 epoch remains the same profile. Absent markers need an identifier.
      const epoch = initial.epoch ?? newEpoch();
      if (typeof epoch !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(epoch))
        error('invalid-epoch', 'The expanded campaign profile could not be protected. No profile data was changed. Reload before saving.');
      const desired = encoded(epoch, 'ready', requiredProtocolVersion);
      verifiedMarkerWrite(initial.raw, desired);
      initial = marker(desired, requiredProtocolVersion);
    }
    boundRaw = initial.raw; boundKnown = initial.phase === 'ready';
  } catch (e) {
    // Never treat an attempted but unverified migration as ordinary unsaved play.
    upgradeError = upgradeAttempted ? e : null;
    initiallyUnavailable = !upgradeAttempted && e.code !== 'invalid-marker';
  }

  function status() {
    let current;
    try { current = read(); }
    catch (e) {
      return { phase: e.code === 'invalid-marker' ? 'invalid' : 'unavailable', canWrite: false,
        canReload: false, reloadRequired: false, recoveryRequired: e.code === 'invalid-marker' || !!transaction || !!upgradeError,
        ownsImport: false, initiallyUnavailable, code: e.code, message: e.message };
    }
    const ownsImport = !!transaction && current.epoch === transaction.epoch && current.raw === transaction.restoringRaw && !transaction.done;
    const upgradeRequired = current.phase === 'ready' && needsUpgrade(current);
    const canWrite = current.phase === 'ready' && !upgradeRequired && !upgradeError && boundKnown && current.raw === boundRaw;
    const reloadRequired = current.phase === 'ready' && !canWrite;
    return { phase: current.phase, canWrite, canReload: current.phase === 'ready', reloadRequired,
      recoveryRequired: current.phase === 'failed', ownsImport, initiallyUnavailable,
      code: current.phase === 'restoring' ? 'restore-in-progress' : current.phase === 'failed' ? 'recovery-required' : upgradeRequired ? 'profile-upgrade-required' : reloadRequired ? 'stale-session' : 'ready',
      message: current.phase === 'restoring' ? 'A backup restoration is in progress. Keep this page paused and do not reload until it finishes.' :
        current.phase === 'failed' ? 'A backup restoration needs recovery. Keep this page paused and close other Ironroot tabs before recovering.' :
        upgradeRequired ? 'The expanded campaign profile could not be protected. Saving is blocked. Restore storage access and reload before making changes.' :
        reloadRequired ? 'This profile was replaced or could not be verified when this tab opened. Reload before making changes.' : 'Profile is ready.' };
  }
  function requireNormalWrite() {
    const state = status();
    if (!state.canWrite) error(state.code, state.message);
  }
  function requireNormalRead() {
    const current = read();
    if (current.phase !== 'ready') error(current.phase === 'failed' ? 'recovery-required' : 'restore-in-progress', 'This profile is being restored or needs recovery. Do not load partial data.');
    if (needsUpgrade(current) || upgradeError || (requiredProtocolVersion >= 5 && !boundKnown)) error('profile-upgrade-required', 'This profile has not been verified for the expanded campaign. Reload before loading or changing its saves.');
  }
  function keyAllowed(key, importing = false) {
    if (typeof key !== 'string' || key === PROFILE_MARKER_KEY || (importing && !IMPORT_KEYS.has(key)))
      error('protected-key', 'This storage operation is outside the permitted game save keys.');
  }
  function requireImport() {
    if (!transaction?.started || transaction.finishing || transaction.done) error('no-owned-import', 'There is no active, verified import owned by this tab.');
    const current = read();
    if (current.raw !== transaction.restoringRaw) error('import-ownership-lost', 'Another tab changed the import marker. This tab will not write or roll back over the newer profile.');
  }
  function facade(importing) {
    return Object.freeze({
      getItem(key) { keyAllowed(key, importing); if (importing) requireImport(); else requireNormalRead(); return backend().getItem(key); },
      setItem(key, value) { keyAllowed(key, importing); if (typeof value !== 'string') throw new TypeError('Save values must be strings.'); if (importing) requireImport(); else requireNormalWrite(); backend().setItem(key, value); },
      removeItem(key) { keyAllowed(key, importing); if (importing) requireImport(); else requireNormalWrite(); backend().removeItem(key); },
    });
  }
  function response(ok, code, message, extra = {}) { return { ok, code, message, ...extra, status: status() }; }
  // Readback decides whether a write took effect, including an adapter that throws after writing.
  function verifiedMarkerWrite(expected, desired) {
    if (rawRead() !== expected) error('import-ownership-lost', 'Another tab changed the profile marker. No further import writes are permitted.');
    try { backend().setItem(PROFILE_MARKER_KEY, desired); } catch { /* Verify actual outcome below. */ }
    const raw = rawRead();
    if (raw === desired) return;
    if (raw !== expected) error('import-ownership-lost', 'The marker changed unexpectedly. Keep this page open; this tab will not overwrite another restoration.');
    error('marker-write-failed', 'The import marker could not be saved and verified. Keep this page open and restore storage access or space before retrying.');
  }

  function beginImport({ recover = false } = {}) {
    if (typeof recover !== 'boolean') return response(false, 'invalid-recovery-option', 'Recovery confirmation must be explicit.');
    let current;
    try {
      try { current = read(); }
      catch (e) {
        if (!recover || e.code !== 'invalid-marker') throw e;
        const raw = rawRead();
        // An explicit recovery may repair corruption, never downgrade a future client.
        let future;
        try { future = JSON.parse(raw); } catch {}
        if (future?.format === FORMAT && Number.isInteger(future.version) && future.version > requiredProtocolVersion)
          error('unsupported-protocol', 'This profile needs a compatible newer version. Its marker and saves were retained.');
        current = { raw, phase: 'invalid', epoch: null };
      }
      if (transaction && !transaction.done && current.raw === transaction.restoringRaw) {
        if (!transaction.started) { transaction.started = true; return response(true, 'import-started', 'Import ownership verified.', { epoch: transaction.epoch }); }
        return response(false, transaction.finishing ? 'finalization-pending' : 'import-in-progress', transaction.finishing ? 'Retry the pending marker finalization before starting another import.' : 'This tab already has an import in progress.');
      }
      if (current.phase === 'ready') {
        if (!boundKnown || current.raw !== boundRaw) return response(false, 'reload-required', 'Reload this changed profile before importing another backup.');
      } else if (!recover) return response(false, 'recovery-confirmation-required', 'Close all other Ironroot tabs and explicitly confirm recovery before replacing an unfinished restoration.');
      const epoch = newEpoch();
      if (typeof epoch !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(epoch) || epoch === current.epoch)
        return response(false, 'invalid-epoch', 'A fresh import identifier could not be created. No profile data was changed.');
      transaction = { epoch, restoringRaw: encoded(epoch, 'restoring', requiredProtocolVersion), priorReady: current.phase === 'ready', started: false, finishing: null, done: false };
      verifiedMarkerWrite(current.raw, transaction.restoringRaw);
      transaction.started = true;
      return response(true, 'import-started', 'Import ownership verified.', { epoch });
    } catch (e) {
      return response(false, e.code || 'marker-write-failed', e.message || 'The import marker could not be verified. No profile data was imported.');
    }
  }

  function finishImport({ outcome } = {}) {
    if (!['restored', 'rolled-back', 'failed'].includes(outcome)) return response(false, 'invalid-outcome', 'A verified import or rollback outcome is required.', { phase: 'blocked', outcome: null });
    if (!transaction?.started) return response(false, 'no-owned-import', 'This tab has no verified import to finalize.', { phase: 'blocked', outcome });
    if (transaction.finishing && transaction.finishing.outcome !== outcome)
      return response(false, 'outcome-conflict', 'Retry finalization with the original outcome; do not change a verified recovery decision.', { phase: 'blocked', outcome });
    // Returning to an already partial profile does not make that profile safe to reload.
    const phase = outcome === 'restored' || (outcome === 'rolled-back' && transaction.priorReady) ? 'ready' : 'failed';
    const desired = encoded(transaction.epoch, phase, requiredProtocolVersion);
    transaction.finishing ||= { outcome, phase, raw: desired };
    try {
      const current = read();
      if (current.raw !== desired) verifiedMarkerWrite(transaction.restoringRaw, desired);
      transaction.done = true;
      if (phase === 'ready' && outcome === 'rolled-back') { boundRaw = desired; boundKnown = true; }
      const message = phase === 'failed' ? 'Recovery is still required. The profile remains locked; keep this page open and close other Ironroot tabs before importing a valid backup.' :
        outcome === 'restored' ? 'Backup restoration and its ready marker are verified. Reload to use the restored profile.' :
        'The original profile and its ready marker are verified. This tab can continue its retained game.';
      return response(true, phase === 'failed' ? 'recovery-required' : 'import-finalized', message, { phase, outcome });
    } catch (e) {
      return response(false, e.code || 'finalization-failed', `${e.message || 'The marker could not be verified.'} Do not reload or resume. Retry finalization with the same outcome when storage is available.`, { phase: 'blocked', outcome });
    }
  }
  return Object.freeze({ storage: facade(false), importStorage: facade(true), status, beginImport, finishImport });
}
