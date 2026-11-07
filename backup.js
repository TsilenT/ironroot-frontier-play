import { decodeBattle, encodeBattle } from './battle-codec.js';
import { validateHistory } from './history-codec.js';
import {
  CAMPAIGN_PROGRESS_MISSIONS, CAMPAIGN_STORAGE_KEY, createCampaignProgress,
  normalizeCampaignProgress,
} from './campaign.js';
import { CURRENT_CHALLENGES as CHALLENGES } from './challenges.js';
import { normalizeKeyboardMap } from './keyboard.js';

export const BACKUP_FORMAT = 'ironroot-backup';
export const BACKUP_VERSION = 1; // Legacy export remains the default when representable.
export const LATEST_BACKUP_VERSION = 2;
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const BACKUP_STORAGE_KEYS = Object.freeze({
  campaign: CAMPAIGN_STORAGE_KEY,
  trials: 'ironroot.trials.v1',
  settings: 'ironroot.settings.v1',
  history: 'ironroot.history.v1',
  battle: 'ironroot.battle.v1',
});
const domains = Object.keys(BACKUP_STORAGE_KEYS);
const own = (value, key) => Object.hasOwn(value, key);

export class BackupError extends Error {
  constructor(message, code = 'invalid-backup') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}
function fail(message, code) { throw new BackupError(message, code); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(`${label} must be a plain object.`);
}
function fields(value, allowed, required, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} contains an unknown field.`);
  if (required.some(key => !own(value, key))) fail(`${label} is missing a required field.`);
}
function number(value, min, max, label, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail(`${label} is outside its valid range.`);
}
function iso(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail(`${label} must be an ISO UTC timestamp.`);
  return value;
}
/** Check bytes before JSON.parse, without requiring DOM, Node or TextEncoder. */
function byteLength(text) {
  if (typeof text !== 'string') fail('Backup input must be JSON text.');
  if (text.length > MAX_BACKUP_BYTES) fail('Backup exceeds the 1 MiB limit.', 'too-large');
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
             text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > MAX_BACKUP_BYTES) fail('Backup exceeds the 1 MiB limit.', 'too-large');
  }
  return bytes;
}
/** Inspect descriptors before reading override values: never invoke their getters/toJSON. */
function bounded(value) {
  let nodes = 0;
  const ancestors = new Set();
  function visit(v, depth) {
    if (++nodes > 30000 || depth > 12) fail('Backup data is too large or deeply nested.', 'too-large');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail('Backup numbers must be finite.'); return; }
    if (typeof v === 'string') { if (v.length > 100) fail('Backup contains an overlong value.', 'too-large'); return; }
    if (typeof v !== 'object') fail('Backup contains a non-JSON value.');
    if (ancestors.has(v)) fail('Backup contains cyclic data.');
    if (Array.isArray(v)) {
      if (v.length > 256) fail('Backup contains an oversized array.', 'too-large');
    } else object(v, 'Backup data');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string')) fail('Backup contains a non-JSON property.');
    const keys = Object.keys(descriptors).filter(k => !(Array.isArray(v) && k === 'length'));
    if (keys.length > 256) fail('Backup contains too many fields.', 'too-large');
    if (Array.isArray(v) && (keys.length !== v.length || keys.some((k, i) => k !== String(i))))
      fail('Backup arrays must be dense and contain no extra properties.');
    ancestors.add(v);
    for (const key of keys) {
      if (key.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Backup contains an unsafe property.');
      const descriptor = descriptors[key];
      if (!own(descriptor, 'value') || !descriptor.enumerable) fail('Backup contains a non-JSON property.');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(v);
  }
  visit(value, 0);
}
function json(text) {
  byteLength(text);
  let value;
  try { value = JSON.parse(text); }
  catch { fail('Backup is not valid JSON.', 'invalid-json'); }
  bounded(value);
  return value;
}
function campaign(value) {
  fields(value, ['format', 'version', 'missions'], ['format', 'version', 'missions'], 'Campaign progress');
  if (value.format !== 'ironroot-campaign') fail('Campaign progress has an invalid format.');
  if (value.version !== 1) fail('Campaign progress has an unsupported version.', 'unsupported-version');
  object(value.missions, 'Campaign missions');
  for (const id of Object.keys(value.missions)) {
    const mission = CAMPAIGN_PROGRESS_MISSIONS.find(m => m.id === id);
    if (!mission) fail('Campaign progress contains an unknown mission.');
    const record = value.missions[id];
    fields(record, ['completed', 'stars', 'bestTime'], ['completed', 'stars', 'bestTime'], 'Campaign record');
    if (record.completed !== true) fail('Campaign records must describe completed missions.');
    number(record.stars, 1, 3, 'Campaign stars', true);
    number(record.bestTime, 0, mission.timeLimit + .25, 'Campaign best time');
  }
  const clean = normalizeCampaignProgress(value);
  if (Object.keys(clean.missions).length !== Object.keys(value.missions).length)
    fail('Campaign progress has a completion without its prerequisites.');
  return clean;
}
function trials(value) {
  object(value, 'Trial records');
  const clean = {};
  for (const id of Object.keys(value)) {
    const challenge = CHALLENGES.find(c => c.id === id);
    if (!challenge) fail('Trial records contain an unknown trial.');
    const record = value[id];
    fields(record, ['completed', 'bestTime'], ['completed', 'bestTime'], 'Trial record');
    if (record.completed !== true || !(record.bestTime > 0)) fail('Trial records require a completed trial and a positive best time.');
    number(record.bestTime, 0, challenge.timeLimit + .25, 'Trial best time');
    clean[id] = { completed: true, bestTime: record.bestTime };
  }
  return clean;
}
function settings(value) {
  const keys = ['sound', 'music', 'sfx', 'volume', 'reducedMotion', 'quality', 'keyboard', 'skirmishBridgeIncome'];
  fields(value, keys, [], 'Preferences');
  const clean = {};
  for (const key of keys) if (own(value, key)) {
    if (key === 'keyboard') {
      try { clean.keyboard = normalizeKeyboardMap(value.keyboard); }
      catch { fail('Battle keyboard controls contain an invalid version, action, key or duplicate binding.'); }
      continue;
    }
    if (key === 'volume') number(value[key], 0, 1, 'Volume');
    else if (key === 'quality') { if (!['high', 'low'].includes(value[key])) fail('Preferences contain an unknown quality.'); }
    else if (typeof value[key] !== 'boolean') fail('Preference toggles must be boolean.');
    clean[key] = value[key];
  }
  return clean;
}
function battle(value, progress) {
  if (value === null) return null;
  try {
    const decoded = decodeBattle(value, { campaignProgress: progress });
    return encodeBattle(decoded.game, decoded.scenario, { campaignProgress: progress });
  } catch (error) { fail(error.message || 'Saved battle contains invalid or incompatible data.', error.code === 'invalid-battle' ? 'invalid-backup' : error.code); }
}
function history(value) {
  try { return validateHistory(value); }
  catch (error) { fail(error.message || 'Recent results are invalid.', error.code); }
}
function needsV2(data) {
  return data.battle?.version === 3 || data.battle?.game?.version === 3 ||
    (Array.isArray(data.history) && data.history.some(row => row && typeof row === 'object' && own(row, 'identity'))) ||
    Object.keys(data.campaign?.missions || {}).some(id => ['first-watch', 'forked-road', 'roadside-watch', 'shield-at-the-fork', 'open-three-roads'].includes(id));
}
function validate(value) {
  bounded(value);
  fields(value, ['format', 'version', 'createdAt', 'data'], ['format', 'version', 'createdAt', 'data'], 'Backup');
  if (value.format !== BACKUP_FORMAT) fail('This is not an Ironroot Frontier backup.');
  if (![1, 2].includes(value.version)) fail('This backup version is not supported.', 'unsupported-version');
  iso(value.createdAt, 'Backup date');
  fields(value.data, domains, domains, 'Backup data');
  const progress = campaign(value.data.campaign);
  if (value.version === 1 && needsV2(value.data)) fail('Version-1 backups cannot contain new battle or history identities.');
  return { format: BACKUP_FORMAT, version: value.version, createdAt: value.createdAt, data: {
    campaign: progress, trials: trials(value.data.trials), settings: settings(value.data.settings),
    history: history(value.data.history), battle: battle(value.data.battle, progress),
  } };
}
export function parseBackup(text) { return validate(json(text)); }

function adapter(storage, writable = false) {
  if (!storage || typeof storage !== 'object') fail('Browser storage is unavailable.', 'storage-unavailable');
  const native = typeof storage.getItem === 'function';
  const names = native ? ['getItem', 'setItem', 'removeItem'] : ['get', 'set', 'remove'];
  if (typeof storage[names[0]] !== 'function' || (writable && names.some(name => typeof storage[name] !== 'function')))
    fail('A readable, reliable storage adapter is required.', 'storage-unavailable');
  return {
    get(key) {
      const value = storage[names[0]](key);
      if (value !== null && typeof value !== 'string') throw new Error('Invalid storage read');
      return value;
    },
    write(key, value) {
      const result = value === null ? storage[names[2]](key) : storage[names[1]](key, value);
      if (!native && result !== true) throw new Error('Storage write failed');
    },
  };
}

export function createBackup(storage, options = {}) {
  object(options, 'Backup options');
  // Options are small, JSON-only caller data, not a vehicle for executable accessors.
  bounded(options);
  fields(options, ['includeBattle', 'createdAt', ...domains], [], 'Backup options');
  if (own(options, 'includeBattle') && typeof options.includeBattle !== 'boolean') fail('includeBattle must be boolean.');
  if (options.includeBattle === false && own(options, 'battle')) fail('Cannot override a battle while excluding it.');
  const io = adapter(storage), raw = {}, data = {}, empty = {
    campaign: createCampaignProgress(), trials: {}, settings: {}, history: [], battle: null,
  };
  let bytes = 0;
  // Finish reading first. A failed read is never converted into empty progress.
  for (const domain of domains) {
    if (own(options, domain) || (domain === 'battle' && options.includeBattle === false)) continue;
    try { raw[domain] = io.get(BACKUP_STORAGE_KEYS[domain]); }
    catch { fail(`Could not read ${domain} for backup. No local data was changed.`, 'storage-read-failed'); }
    if (raw[domain] !== null) bytes += byteLength(raw[domain]);
    if (bytes > MAX_BACKUP_BYTES) fail('Local game data exceeds the 1 MiB backup limit.', 'too-large');
  }
  for (const domain of domains) {
    try {
      data[domain] = own(options, domain) ? options[domain] :
        domain === 'battle' && options.includeBattle === false ? null :
        raw[domain] === null ? empty[domain] : json(raw[domain]);
    } catch (error) {
      if (error instanceof BackupError) fail(`Could not export ${domain}: ${error.message}`, error.code);
      throw error;
    }
  }
  const clean = validate({ format: BACKUP_FORMAT, version: needsV2(data) ? 2 : 1,
    createdAt: own(options, 'createdAt') ? options.createdAt : new Date().toISOString(), data });
  const text = JSON.stringify(clean, null, 2);
  byteLength(text);
  return text;
}

function emptyRollback() { return { attempted: false, complete: null, unrestoredKeys: [], unverifiedKeys: [] }; }
/** A synchronous, verified replacement with best-effort rollback, never a claimed atomic transaction. */
export function restoreBackup(storage, text) {
  let backup, io;
  const result = (ok, code, message, extra = {}) => ({ ok, code, message, changedKeys: [], failedKey: null, rollback: emptyRollback(), ...extra });
  try { backup = parseBackup(text); }
  catch (error) { return result(false, error.code || 'invalid-backup', error.message || 'Invalid backup. No local data was changed.'); }
  try { io = adapter(storage, true); }
  catch { return result(false, 'storage-unavailable', 'Browser storage is unavailable. No local data was changed.'); }
  const before = new Map(), after = new Map();
  for (const domain of domains) {
    const key = BACKUP_STORAGE_KEYS[domain];
    try { before.set(key, io.get(key)); }
    catch { return result(false, 'storage-read-failed', 'Could not read the existing saves. No local data was changed.', { failedKey: key }); }
    after.set(key, domain === 'battle' && backup.data.battle === null ? null : JSON.stringify(backup.data[domain]));
  }
  const changed = [...after.keys()].filter(key => before.get(key) !== after.get(key));
  const attempted = [];
  let failedKey = null;
  try {
    for (const key of changed) {
      failedKey = key;
      // Detect a changed destination before overwriting it. Other tabs remain outside our control.
      if (io.get(key) !== before.get(key)) throw new Error('Destination changed');
      attempted.push(key);
      io.write(key, after.get(key));
      if (io.get(key) !== after.get(key)) throw new Error('Write could not be verified');
    }
    for (const [key, value] of after) {
      failedKey = key;
      if (io.get(key) !== value) throw new Error('Replacement could not be verified');
    }
    return result(true, 'restored', 'Backup imported and verified. Reload the game to use the restored data.', { changedKeys: changed });
  } catch {
    for (const key of [...attempted].reverse()) {
      try { if (io.get(key) === before.get(key)) continue; } catch { /* A write may still restore readable access. */ }
      try { io.write(key, before.get(key)); } catch { /* Verify actual bytes below, regardless of the adapter result. */ }
    }
    const unrestoredKeys = [], unverifiedKeys = [];
    for (const [key, value] of before) {
      try { if (io.get(key) !== value) unrestoredKeys.push(key); }
      catch { unverifiedKeys.push(key); }
    }
    const complete = unrestoredKeys.length === 0 && unverifiedKeys.length === 0;
    const warning = complete ? 'Import failed. All previous local saves were restored and verified.' :
      'Import failed and previous saves could not be fully restored.' +
      (unrestoredKeys.length ? ` Still changed: ${unrestoredKeys.join(', ')}.` : '') +
      (unverifiedKeys.length ? ` Cannot verify: ${unverifiedKeys.join(', ')}.` : '') +
      ' Keep this page open and retain the backup file; resolve storage access or space before retrying.';
    return result(false, complete ? 'write-failed-rolled-back' : 'rollback-incomplete', warning, {
      failedKey, changedKeys: unrestoredKeys,
      rollback: { attempted: attempted.length > 0, complete, unrestoredKeys, unverifiedKeys },
    });
  }
}
