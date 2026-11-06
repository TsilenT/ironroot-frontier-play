import { MAPS, getMap, getRuleset } from './engine.js';
import { CAMPAIGN_MISSIONS } from './campaign.js';
import { CHALLENGES } from './challenges.js';
import { validateBattleIdentity, resolveScenario } from './battle-codec.js';

function fail(message) { throw new Error(message); }
const own = (value, key) => Object.hasOwn(value, key);
function fields(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !allowed.includes(k) || !own(descriptors[k], 'value') || !descriptors[k].enumerable)) fail(`${label} contains an unknown field or non-JSON property.`);
  if (required.some(k => !own(value, k))) fail(`${label} is missing a required field.`);
}
function number(value, min, max, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(`${label} is outside its valid range.`);
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Recent result date must be an ISO UTC timestamp.');
  return value;
}
function legacyIdentity(value) {
  const challengeId = own(value, 'challengeId') ? value.challengeId : null;
  const campaignId = own(value, 'campaignId') ? value.campaignId : null;
  if (challengeId !== null && (typeof challengeId !== 'string' || !CHALLENGES.some(c => c.id === challengeId))) fail('Battle identity contains an unknown trial.');
  if (campaignId !== null && (typeof campaignId !== 'string' || !CAMPAIGN_MISSIONS.some(m => m.id === campaignId))) fail('Battle identity contains an unknown campaign mission.');
  if (challengeId !== null && campaignId !== null) fail('A battle cannot be both a trial and a campaign mission.');
  return { challengeId, campaignId };
}
/** Shared result validation for backup and the history write boundary. No storage access. */
export function validateHistory(value) {
  if (!Array.isArray(value) || value.length > 30) fail('Recent results must contain at most 30 entries.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 || !Array.from({ length: value.length }, (_, i) => descriptors[i]).every(d => d && own(d, 'value') && d.enumerable)) fail('Recent results must be a dense JSON array.');
  return value.map(validateHistoryRow);
}
export function validateHistoryRow(record) {
  const modern = !!record && typeof record === 'object' && own(record, 'identity');
  const common = ['won', 'draw', 'difficulty', 'time', 'kills', 'built', 'date'];
  fields(record, [...common, ...(modern ? ['identity'] : ['challengeId', 'campaignId', 'mapId'])], ['won', 'difficulty', 'time', 'kills', 'built', 'date', ...(modern ? ['identity'] : [])], 'Recent result');
  const draw = own(record, 'draw') ? record.draw : false;
  if (typeof record.won !== 'boolean' || typeof draw !== 'boolean' || (record.won && draw)) fail('Recent result has invalid win/draw flags.');
  if (!['easy', 'normal', 'hard'].includes(record.difficulty)) fail('Recent result has an unknown difficulty.');
  let ids, authored, identity, limits = { maxTime: 10000, maxCounter: 1e9 }, map = {};
  if (modern) {
    identity = validateBattleIdentity(record.identity);
    const scenario = resolveScenario(identity.scenario);
    if (scenario.kind === 'lesson') fail('Practice lessons are not saved results.');
    authored = scenario.mission;
    limits = getRuleset(identity.ruleset.id, identity.ruleset.revision).limits;
    if (authored && record.difficulty !== authored.difficulty) fail('Recent result does not match its mission difficulty.');
  } else {
    ids = legacyIdentity(record);
    authored = ids.challengeId ? CHALLENGES.find(c => c.id === ids.challengeId) : CAMPAIGN_MISSIONS.find(m => m.id === ids.campaignId);
    if (['first-watch', 'forked-road'].includes(ids.campaignId)) fail('This mission requires an explicit result identity.');
    if (own(record, 'mapId')) {
      if (typeof record.mapId !== 'string' || !own(MAPS, record.mapId)) fail('Recent result contains an unknown battlefield.');
      map.mapId = record.mapId;
    }
    if (authored && (record.mapId ?? 'classic') !== (authored.mapId ?? 'classic')) fail(`Authored mission results require the ${getMap(authored.mapId ?? 'classic').name} battlefield.`);
  }
  number(record.time, 0, authored ? authored.timeLimit + .25 : limits.maxTime, 'Recent result time');
  number(record.kills, 0, limits.maxCounter, 'Recent result kills', true);
  number(record.built, 0, limits.maxCounter, 'Recent result buildings', true);
  const statistics = { difficulty: record.difficulty, time: record.time, kills: record.kills, built: record.built, date: iso(record.date) };
  return modern ? { won: record.won, draw, ...statistics, identity } : { won: record.won, draw, ...ids, ...statistics, ...map };
}
