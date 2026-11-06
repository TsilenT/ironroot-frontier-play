import { createProfileSession, PROFILE_MARKER_KEY } from './profile-session.js';
import { createInputScopeGuard } from './input-scope.js';
import {
  GamepadInput,
  moveCursor,
  nextFocusIndex,
  spatialFocusIndex,
  nextAffordableIndex,
} from './controller.js';
import {
  createBackup,
  parseBackup,
  restoreBackup,
  MAX_BACKUP_BYTES,
} from './backup.js';
import {
  Game,
  BUILDINGS,
  UNITS,
  MAPS,
  getMap,
  buildBounds,
  SPELL,
  upgradeCost,
} from './engine.js';
import { Renderer, iconSVG, drawUnitPortrait } from './render.js';
import { renderMissionScouting } from './scouting.js';
import { createBattleJournal, exportBattleReport } from './battle-report.js';
import { renderBattleReport } from './report-view.js';
import {
  UNIT_CODEX,
  STRUCTURE_CODEX,
  ECONOMY_GUIDE,
  formatNumber,
  formatSeconds,
} from './codex.js';
import {
  CHALLENGES,
  createChallenge,
  getChallengeTargets,
  evaluateChallenge,
} from './challenges.js';
import {
  createStorage,
  createSaveSession,
  readHistoryState,
  createHistorySession,
  createPreferenceSession,
  writeBattle,
  nativeSpaceTarget,
} from './persistence.js';
import { GameAudio } from './audio.js';
import { advanceObjectiveBattle } from './objectives.js';
import {
  CAMPAIGN_CHAPTERS,
  CAMPAIGN_MISSIONS,
  createCampaignMission,
  evaluateCampaignMission,
  getCampaignTargets,
  readCampaignProgress,
  mergeCampaignProgress,
  writeCampaignProgress,
  recordCampaignResult,
  getCampaignOverview,
  isMissionUnlocked,
} from './campaign.js';
const $ = (id) => document.getElementById(id);
const renderer = new Renderer($('battle'), $('minimap'));

// Read-only field reference. Text is authored data; escape it before markup.
function populateFieldGuide() {
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const n = formatNumber;
  const list = (items) =>
    `<ul>${items.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>`;
  const stats = (values) =>
    `<dl class="codex-stats">${values.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  $('codexScope').textContent = ECONOMY_GUIDE.scope;
  $('codexCaveat').textContent = ECONOMY_GUIDE.counterCaveat;
  $('unitCodex').innerHTML = UNIT_CODEX.map(
    (u) => `<details class="codex-card" data-codex-unit="${esc(u.id)}">
    <summary><canvas data-portrait="${esc(u.portraitId)}" width="224" height="200" aria-hidden="true"></canvas><span><strong>${esc(u.name)}</strong><small>${esc(u.role)}</small><em>${u.baseStats.canAttackAir ? 'GROUND + AIR' : 'GROUND TARGETS'}${u.baseStats.flying ? ' · FLYING' : ''}</em></span><span class="codex-expand" aria-hidden="true">+</span></summary>
    <div class="codex-body">
      ${stats([
        ['Health', n(u.baseStats.hp)],
        ['Hit', n(u.baseStats.damage)],
        ['Cooldown', formatSeconds(u.baseStats.attackTime)],
        ['Range', n(u.baseStats.range)],
        ['Speed', `${n(u.baseStats.speed)} /s`],
        ['Repeat spawn', formatSeconds(u.production.spawnTime)],
      ])}
      <p><b>${esc(u.production.name)}</b> · ${n(u.production.cost)} gold<br>Upgrades: ${u.production.upgradeCosts.map(n).join(' / ')} gold</p>
      <p><b>Use it for:</b> ${esc(u.advantages)}</p>
      <p><b>Watch out for:</b> ${esc(u.cautions)}</p>
      ${list(u.mechanics)}
    </div></details>`,
  ).join('');
  for (const canvas of $('unitCodex').querySelectorAll('[data-portrait]'))
    drawUnitPortrait(canvas, canvas.dataset.portrait);
  $('structureCodex').innerHTML = STRUCTURE_CODEX.map(
    (
      b,
    ) => `<details class="codex-card codex-structure" data-codex-structure="${esc(b.id)}">
    <summary><span class="codex-building" aria-hidden="true">${iconSVG(b.id)}</span><span><strong>${esc(b.name)}</strong><small>${esc(b.role)}</small><em>${n(b.cost)} GOLD · ${n(b.hp)} HEALTH</em></span><span class="codex-expand" aria-hidden="true">+</span></summary>
    <div class="codex-body"><p><b>Upgrades:</b> ${b.upgradeCosts.map(n).join(' / ')} gold</p><p><b>Use it for:</b> ${esc(b.advantages)}</p><p><b>Watch out for:</b> ${esc(b.cautions)}</p>${list(b.mechanics)}</div></details>`,
  ).join('');
  $('economyCodex').innerHTML = `${stats([
    ['Starting gold', n(ECONOMY_GUIDE.startingGold)],
    ['Base income', `${n(ECONOMY_GUIDE.baseIncome)} /s`],
    ['Citadel health', n(ECONOMY_GUIDE.citadelHp)],
    ['Mine cap', n(ECONOMY_GUIDE.mineCap)],
  ])}
    <h3>Build an economy you can defend</h3>${list(ECONOMY_GUIDE.notes)}<h3>Invest in survivors</h3>${list(ECONOMY_GUIDE.upgrades)}<h3>When the war runs long</h3><p>${esc(ECONOMY_GUIDE.overtime.description)}</p>`;
}
populateFieldGuide();

let battleJournal = null, lastBattleReport = null, hasLastResult = false, reportFault = false;
let selectedMap = 'classic';
let difficulty = 'easy',
  game = new Game({ difficulty }),
  started = false,
  paused = false,
  speed = 1,
  last = performance.now(),
  saveTimer = 0,
  toastTimer = 0,
  resultShown = false,
  follow = false,
  helpWasPaused = false;
const ui = {
  build: null,
  spell: false,
  selected: null,
  pointer: null,
  dragging: false,
};
let mode = 'skirmish',
  selectedChallenge = CHALLENGES[0].id,
  currentChallenge = null,
  currentCampaign = null,
  objectiveOutcome = null,
  selectedCampaign = CAMPAIGN_MISSIONS[0].id,
  selectedChapter = CAMPAIGN_CHAPTERS[0].id;
const labels = {
  barracks: ['Barracks', 'Shielded warriors', '9s / wave'],
  archery: ['Archery', 'Ranged support', '10s / wave'],
  foundry: ['Foundry', 'Structure breaker', '17s / wave'],
  watchtower: ['Watchtower', 'Hold the line', 'Ranged defense'],
  mint: ['Gold mine', 'Grow your economy', '+2.5 gold /s'],
  sanctum: ['Sanctum', 'Magic & splash', '14s / wave'],
  aerie: ['Aerie', 'Flying raiders', '15s / wave'],
};
const profileSession = createProfileSession(() => localStorage, { requiredProtocolVersion: 2 });
const storage = createStorage(() => profileSession.storage);
let recoveryHold = null,
  profileGate = null,
  pendingFinalizeOutcome = null,
  allowProfileReload = false,
  importGeneration = 0,
  retainedHistory = null;
let saveWarning = false;
const SETTINGS = 'ironroot.settings.v1',
  SAVE = 'ironroot.battle.v1',
  HISTORY = 'ironroot.history.v1',
  TRIALS = 'ironroot.trials.v1';
const battleSession = createSaveSession(storage, SAVE);
const canPersistRetained = () => !recoveryHold && !profileGate && profileSession.status().canWrite;
const historySession = createHistorySession(storage, HISTORY, { canWrite: canPersistRetained });
const preferenceSession = createPreferenceSession(storage, SETTINGS, { canWrite: canPersistRetained });
let knownHistory = historySession.snapshot().rows,
  knownHistoryAvailable = historySession.snapshot().ok;
let campaignProgress = readCampaignProgress(storage),
  progressDirty = false;
const nextCampaign = getCampaignOverview(campaignProgress).nextMissionId;
if (nextCampaign) {
  selectedCampaign = nextCampaign;
  selectedChapter = CAMPAIGN_MISSIONS.find(
    (m) => m.id === nextCampaign,
  ).chapterId;
}
let trialRecords = {};
try {
  const value = JSON.parse(storage.get(TRIALS) || '{}');
  if (value && typeof value === 'object' && !Array.isArray(value))
    trialRecords = Object.fromEntries(
      Object.entries(value).filter(
        ([id, r]) =>
          CHALLENGES.some((c) => c.id === id) &&
          r &&
          r.completed === true &&
          Number.isFinite(r.bestTime) &&
          r.bestTime > 0,
      ),
    );
} catch {}
const preferences = {
  sound: true,
  music: true,
  sfx: true,
  volume: 0.5,
  reducedMotion: renderer.reducedMotion,
  quality: 'high',
};
try {
  const saved = JSON.parse(preferenceSession.initial().value || '{}');
  if (saved && typeof saved === 'object') {
    for (const key of ['sound', 'music', 'sfx', 'reducedMotion'])
      if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
    if (Number.isFinite(saved.volume))
      preferences.volume = Math.max(0, Math.min(1, saved.volume));
    if (['high', 'low'].includes(saved.quality))
      preferences.quality = saved.quality;
  }
} catch {}
let soundOn = preferences.sound;
const audio = new GameAudio({
  muted: !soundOn,
  volume: preferences.volume,
  musicEnabled: preferences.music,
  sfxEnabled: preferences.sfx,
});
renderer.reducedMotion = preferences.reducedMotion;
renderer.vfx.setPreferences({
  reducedMotion: preferences.reducedMotion,
  quality: preferences.quality,
});
function initAudio() {
  audio.unlock().then((ok) => {
    if (!ok && soundOn)
      toast('Audio is unavailable in this browser. You can keep playing.');
  });
}
function sound(name, options) {
  audio.play(name, options);
}
function updatePreferenceSaveStatus() {
  const dirty = preferenceSession.dirty();
  $('preferenceSaveWarning').classList.toggle('hidden', !dirty);
  $('retryPreferences').classList.toggle('hidden', !dirty);
  $('preferenceSaveWarning').textContent = dirty
    ? 'These preferences apply only to this page and are not verified saved. ' +
      (['changed', 'initial-unavailable', 'blocked'].includes(preferenceSession.reason())
        ? 'The saved profile or preferences cannot be safely replaced by this tab. Export this session before reloading.'
        : 'Keep this page open, restore storage access or space, then retry saving.')
    : '';
}
function retryPreferences(notify = false) {
  const dirty = preferenceSession.dirty(), ok = preferenceSession.retry();
  updatePreferenceSaveStatus();
  if (notify && dirty && ok) toast('Preferences saved.');
  return ok;
}
function savePreferences() {
  preferences.sound = soundOn;
  preferenceSession.stage(preferences);
  const ok = retryPreferences();
  if (!ok) toast('Preferences apply to this page only. Open Preferences to retry saving.');
  return ok;
}
function updateHistorySaveStatus(read = null) {
  const pending = historySession.pendingCount(), reason = pending ? historySession.reason() : read?.reason;
  const issue = pending || (read && !read.ok);
  const message = pending
    ? `${pending} completed battle result${pending === 1 ? '' : 's'} not verified saved. Keep this page open. ` +
      (reason === 'malformed'
        ? 'Existing history is unreadable and has not been replaced. Export the retained session before restoring a backup.'
        : ['blocked', 'battle-stale'].includes(reason)
          ? 'This profile or battle save changed. Export the retained session before reloading; this result will not replace it.'
          : 'Restore storage access or space, then retry. Existing history will be checked again.')
    : read && !read.ok
      ? (reason === 'malformed' ? 'Stored battle history is unreadable and has not been changed.' : 'Stored battle history is unavailable. Keep this page open and try again.')
      : '';
  $('historySaveWarning').classList.toggle('hidden', !issue);
  $('historySaveWarning').textContent = message;
  $('retryHistory').classList.toggle('hidden', !pending);
  $('resultHistoryWarning').classList.toggle('hidden', !pending);
  $('resultHistoryWarning').textContent = pending ? message : '';
  $('retryResultHistory').classList.toggle('hidden', !pending);
}
function retryHistorySave(notify = false) {
  const pending = historySession.pendingCount(), ok = historySession.retry();
  const snapshot = historySession.snapshot();
  if (snapshot.ok) { knownHistory = snapshot.rows; knownHistoryAvailable = true; }
  updateHistorySaveStatus();
  if (notify && pending && ok) toast('Battle history saved.');
  return ok;
}
$('retryPreferences').onclick = () => retryPreferences(true);
$('retryHistory').onclick = () => { retryHistorySave(true); syncSettings(); };
$('retryResultHistory').onclick = () => retryHistorySave(true);
function timeText(t) {
  const sec = Math.floor(t + 1e-6);
  return `${Math.floor(sec / 60)
    .toString()
    .padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
}
function positionToast() {
  const objective = $('objectiveHUD');
  $('toast').style.top = objective.classList.contains('hidden')
    ? ''
    : `${objective.offsetTop + objective.offsetHeight + 8}px`;
}
function toast(text) {
  $('toast').textContent = text;
  positionToast();
  $('toast').classList.add('show');
  toastTimer = 3;
}
function setSound() {
  audio.setMuted(!soundOn);
  $('sound').classList.toggle('muted', !soundOn);
  $('sound').textContent = soundOn ? '♫' : '♪';
  $('sound').setAttribute(
    'aria-label',
    soundOn ? 'Mute audio' : 'Enable audio',
  );
  $('sound').title = soundOn
    ? 'Mute music and sound'
    : 'Enable music and sound';
  if ($('audioEnabled')) $('audioEnabled').checked = soundOn;
}

setSound();
for (const [type, d] of Object.entries(BUILDINGS)) {
  const label = labels[type] || [
    d.name,
    d.unit ? 'Auto-spawning troops' : 'Frontier building',
    '',
  ];
  const btn = document.createElement('button');
  btn.className = 'build-card';
  btn.dataset.type = type;
  btn.title = `${d.name} · ${d.cost} gold. ${d.description}`;
  btn.setAttribute('aria-label', `${d.name}, ${d.cost} gold. ${d.description}`);
  btn.innerHTML = `<span class="hotkey">${Object.keys(BUILDINGS).indexOf(type) + 1}</span><div class="card-top"><span class="building-symbol">${iconSVG(type)}</span><div><h3>${label[0]}</h3><span class="role">${label[1]}</span></div></div><span class="cost">◆ ${d.cost}<small>${label[2]}</small></span>`;
  btn.addEventListener('click', () => selectBuild(type));
  $('buildCards').append(btn);
}
function canInteract() {
  return (
    started &&
    !paused &&
    !recoveryHold &&
    !profileGate &&
    game.state.winner === null &&
    !objectiveOutcome
  );
}
function selectBuild(type) {
  if (!canInteract()) return;
  if (game.state.gold[0] < BUILDINGS[type].cost) {
    toast(`Need ${BUILDINGS[type].cost} gold for ${BUILDINGS[type].name}.`);
    sound('error');
    return;
  }
  ui.build = ui.build === type ? null : type;
  ui.spell = false;
  ui.selected = null;
  follow = false;
  updateSelection();
  syncChoice();
  sound('click');
}
function cancel() {
  ui.build = null;
  ui.spell = false;
  ui.selected = null;
  ui.pointer = null;
  updateSelection();
  syncChoice();
}
function syncChoice() {
  document
    .querySelectorAll('.build-card')
    .forEach((b) => b.classList.toggle('active', b.dataset.type === ui.build));
  $('rally').classList.toggle('active', ui.spell);
  $('battle').classList.toggle('placing', !!ui.build || ui.spell);
  $('cancelBuild').classList.toggle('hidden', !ui.build && !ui.spell);
  $('buildPrompt').textContent = ui.build
    ? `PLACE ${BUILDINGS[ui.build].name.toUpperCase()} · ◆ ${BUILDINGS[ui.build].cost}`
    : ui.spell
      ? 'RALLY STRIKE · TAP ENEMY TROOPS'
      : 'BUILD YOUR FRONTIER';
  $('buildHelp').textContent = ui.build
    ? BUILDINGS[ui.build].description
    : ui.spell
      ? 'Deals damage to enemies in a wide area.'
      : $('buildCards').scrollWidth > $('buildCards').clientWidth + 2
        ? 'Scroll for more buildings. Choose one, then tap a green slot.'
        : 'Choose a building, then place it in your territory.';
}
function updateSelection() {
  const b = game.state.buildings.find(
    (x) => x.id === ui.selected && x.side === 0,
  );
  $('selectionPanel').classList.toggle('hidden', !b);
  if (!b) return;
  const d = BUILDINGS[b.type];
  $('selectionIcon').innerHTML = iconSVG(b.type);
  $('selectionTitle').textContent = d.name;
  $('selectionDetail').textContent =
    `Level ${b.level} · ${d.unit ? UNITS[d.unit].name + ' production' : d.range ? 'Defensive structure' : 'Economy'}`;
  $('selectionStats').innerHTML =
    `<span>♥ ${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}</span><span>${d.unit ? `${(d.spawnTime / (1 + 0.22 * (b.level - 1)) / (game.state.overtime ? 1.65 : 1)).toFixed(1)}s / wave` : d.range ? `Range ${d.range}` : `+${(2.5 * (1 + 0.5 * (b.level - 1))).toFixed(1)} gold /s`}</span>`;
  $('selectionDescription').textContent = d.description;
  const cost = upgradeCost(b);
  $('upgrade').textContent = b.level < 3 ? `Upgrade · ◆ ${cost}` : 'Max level';
  $('upgrade').disabled =
    b.level >= 3 ||
    game.state.gold[0] < cost ||
    paused ||
    game.state.winner !== null;
  $('sell').textContent =
    `Salvage · +${Math.floor((b.invested * 0.5 * b.hp) / b.maxHp)}`;
  $('sell').disabled =
    paused || game.state.winner !== null || ui.protectedTargets?.includes(b.id);
  if (ui.protectedTargets?.includes(b.id)) {
    $('sell').textContent = 'Protected objective';
    $('selectionDescription').textContent =
      'Keep this objective alive. ' + d.description;
  }
}
$('upgrade').onclick = () => {
  const r = game.upgrade(ui.selected);
  if (r.ok) {
    sound('upgrade');
    const b = r.building;
    toast(
      BUILDINGS[b.type].unit
        ? 'Upgraded: tougher troops and faster waves.'
        : b.type === 'mint'
          ? 'Upgraded: more gold per second.'
          : 'Upgraded: stronger walls and attacks.',
    );
  } else toast(r.reason);
  updateSelection();
};
$('sell').onclick = () => {
  const r = game.sell(ui.selected);
  if (r.ok) {
    sound('click');
    toast(`Building salvaged for ${r.refund} gold.`);
    cancel();
  } else toast(r.reason);
};
let closeSelectionArmed = false;
document.addEventListener(
  'pointerdown',
  (e) => {
    closeSelectionArmed = $('closeSelection').contains(e.target);
  },
  { capture: true },
);
$('closeSelection').onclick = (e) => {
  if (e.detail !== 0 && !closeSelectionArmed) return;
  closeSelectionArmed = false;
  ui.selected = null;
  updateSelection();
};
$('cancelBuild').onclick = cancel;
$('rally').onclick = () => {
  if (!canInteract()) return;
  if (game.state.spellCooldown[0] > 0) {
    toast(
      `Rally strike ready in ${Math.ceil(game.state.spellCooldown[0])} seconds.`,
    );
    return;
  }
  if (game.state.gold[0] < SPELL.cost) {
    toast(`Need ${SPELL.cost} gold.`);
    return;
  }
  ui.spell = !ui.spell;
  ui.build = null;
  ui.selected = null;
  updateSelection();
  syncChoice();
  sound('click');
};
function pauseControl(mode = 'pause') {
  const b = $('pause');
  b.innerHTML =
    mode === 'pause'
      ? '<span class="pause-bars" aria-hidden="true"><i></i><i></i></span>'
      : mode === 'resume'
        ? '▶'
        : '↻';
  b.setAttribute(
    'aria-label',
    mode === 'pause'
      ? 'Pause game'
      : mode === 'resume'
        ? 'Resume game'
        : 'Return to title',
  );
  b.title =
    mode === 'pause'
      ? 'Pause (Space)'
      : mode === 'resume'
        ? 'Resume (Space)'
        : 'Return to title';
}
pauseControl();
function pause(value) {
  if (!value && (recoveryHold || profileGate)) {
    showRecoverySettings();
    return;
  }
  if (!started || game.state.winner !== null || objectiveOutcome) return;
  if (!value && battleSession.status() === 'stale') {
    showTitle();
    toast('A newer battle is available. Choose Resume to continue it.');
    return;
  }
  paused = value;
  $('pauseVeil').classList.toggle('hidden', !paused);
  pauseControl(paused ? 'resume' : 'pause');
  if (paused) save();
}
$('pause').onclick = () => pause(!paused);
$('resume').onclick = () => pause(false);
$('saveExit').onclick = () => {
  if (recoveryHold || profileGate) {
    showRecoverySettings();
    return;
  }
  if (battleSession.status() === 'stale') {
    showTitle();
    toast(
      'A newer battle is saved in another tab. Resume it here from the title screen.',
    );
    return;
  }
  if (!save() || (progressDirty && !persistProgress())) {
    toast(
      'Could not save on this browser. Keep this battle open or free some storage, then try again.',
    );
    return;
  }
  showTitle();
};
$('speed').onclick = () => {
  speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
  $('speed').textContent = `${speed}×`;
};
$('sound').onclick = () => {
  soundOn = !soundOn;
  if (soundOn) initAudio();
  setSound();
  savePreferences();
  sound('click');
};
$('home').onclick = () => {
  renderer.camera = 450;
  renderer.clampCamera();
  follow = false;
};
$('front').onclick = () => {
  renderer.camera = game.state.frontline;
  renderer.clampCamera();
  follow = !follow;
  $('front').style.borderColor = follow ? '#f0d18a' : '';
};
function showHelp() {
  helpWasPaused = paused;
  if (started && game.state.winner === null) {
    paused = true;
    $('pauseVeil').classList.add('hidden');
  }
  $('helpModal').classList.remove('hidden');
  $('closeHelp').focus();
}
function hideHelp() {
  $('helpModal').classList.add('hidden');
  if (started && game.state.winner === null) pause(helpWasPaused);
}
$('help').onclick = showHelp;
$('welcomeHelp').onclick = showHelp;
$('closeHelp').onclick = hideHelp;
$('guideDone').onclick = hideHelp;

const mapDescriptions = {
  classic:
    'Three roads, 24 building sites per side. The original frontier, used by every campaign mission and field trial.',
  'long-march':
    'Three roads with a longer neutral crossing, 24 sites per side. Reinforcements take longer to arrive. Troop and income rules are unchanged.',
  'twin-span':
    'Two roads, 16 building sites per side. Fewer fronts and less construction space concentrate the battle. Troop and income rules are unchanged.',
};
function renderMapSelection() {
  $('selectedMapName').textContent = getMap(selectedMap).name;
  $('mapDescription').textContent = mapDescriptions[selectedMap];
  for (const button of $('mapChoices').querySelectorAll('[data-map]')) {
    const active = button.dataset.map === selectedMap;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
for (const map of Object.values(MAPS)) {
  const button = document.createElement('button');
  button.dataset.map = map.id;
  const sx = 320 / map.width;
  const roads = map.lanes
    .map(
      (y) => `<path d="M11 ${y / 10}H309" stroke="#b5aa77" stroke-width="5"/>`,
    )
    .join('');
  button.innerHTML = `<svg viewBox="0 0 320 90" aria-hidden="true"><rect width="320" height="90" rx="7" fill="#253e2c"/><rect x="${200 * sx}" y="18" width="${1120 * sx}" height="54" fill="#679d8555"/><rect x="${(map.width - 1320) * sx}" y="18" width="${1120 * sx}" height="54" fill="#c1816b55"/>${roads}<circle cx="${110 * sx}" cy="45" r="7" fill="#b7dbad"/><circle cx="${(map.width - 110) * sx}" cy="45" r="7" fill="#e5ac89"/></svg><b>${map.name}</b><small>${map.lanes.length} roads · ${map.buildLimit} sites</small>`;
  button.onclick = () => {
    selectedMap = map.id;
    renderMapSelection();
    sound('click');
  };
  $('mapChoices').append(button);
}
renderMapSelection();

for (const btn of document.querySelectorAll('[data-difficulty]'))
  btn.onclick = () => {
    difficulty = btn.dataset.difficulty;
    document
      .querySelectorAll('[data-difficulty]')
      .forEach((b) => b.classList.toggle('active', b === btn));
    sound('click');
  };
function start(
  restored = null,
  restoredChallenge = null,
  restoredCampaign = null,
) {
  syncProfileSafety();
  if (recoveryHold || profileGate) {
    showRecoverySettings();
    return;
  }
  const cid = restored
    ? restoredCampaign
    : mode === 'campaign'
      ? selectedCampaign
      : null;
  if (cid && !isMissionUnlocked(campaignProgress, cid)) {
    toast('Complete the preceding missions to unlock this one.');
    return;
  }
  currentCampaign = cid;
  currentChallenge = restored
    ? restoredChallenge
    : mode === 'challenges'
      ? selectedChallenge
      : null;
  game =
    restored ||
    (currentCampaign
      ? createCampaignMission(currentCampaign)
      : currentChallenge
        ? createChallenge(currentChallenge)
        : new Game({ difficulty, seed: Date.now() >>> 0, mapId: selectedMap }));
  if (!currentChallenge && !currentCampaign) {
    selectedMap = game.map.id;
    renderMapSelection();
    difficulty = game.difficulty;
    document
      .querySelectorAll('[data-difficulty]')
      .forEach((b) =>
        b.classList.toggle('active', b.dataset.difficulty === difficulty),
      );
  }
  beginBattleReport(!!restored);
  battleSession.claim();
  padHud = false;
  padPoint = { x: renderer.width / 2, y: renderer.height / 2 };
  started = true;
  paused = false;
  speed = 1;
  resultShown = false;
  follow = false;
  objectiveOutcome = null;
  heardEffects = new WeakSet();
  heardProjectiles = new WeakSet();
  renderer.vfx?.reset();
  cancel();
  $('welcome').classList.add('hidden');
  $('resultModal').classList.add('hidden');
  $('pauseVeil').classList.add('hidden');
  const mission =
    currentCampaign && CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign);
  if (mission) {
    mode = 'campaign';
    selectedCampaign = mission.id;
    selectedChapter = mission.chapterId;
  } else if (currentChallenge) {
    mode = 'challenges';
    selectedChallenge = currentChallenge;
  } else mode = 'skirmish';
  $('matchType').textContent = currentCampaign
    ? 'CAMPAIGN'
    : currentChallenge
      ? 'FIELD TRIAL'
      : 'SOLO SKIRMISH';
  $('opponentLabel').textContent = mission
    ? mission.name.toUpperCase()
    : currentChallenge
      ? CHALLENGES.find((c) => c.id === currentChallenge).name.toUpperCase()
      : {
          easy: 'THE OUTRIDER',
          normal: 'THE IRON MARSHAL',
          hard: 'THE WARLORD',
        }[difficulty];
  renderer.setMap(game.map);
  renderer.setTheme?.(
    mission
      ? CAMPAIGN_CHAPTERS.find((c) => c.id === mission.chapterId).theme
      : 'woodland',
  );
  $('speed').textContent = '1×';
  pauseControl();
  $('pause').onclick = () => pause(!paused);
  renderer.camera = restored ? game.state.frontline : 450;
  renderer.clampCamera();
  initAudio();
  sound('build');
  toast(
    restored
      ? 'Battle resumed. Your frontier awaits.'
      : mission
        ? mission.objective
        : currentChallenge
          ? CHALLENGES.find((c) => c.id === currentChallenge).objective
          : 'Choose a building, then tap a green slot to raise it.',
  );
  $('battle').focus();
  save();
}
function beginBattleReport(resumed) {
  battleJournal = null;
  lastBattleReport = null;
  hasLastResult = false;
  reportFault = false;
  $('lastResult').classList.add('hidden');
  $('resultReport').classList.add('hidden');
  $('resultReport').textContent = '';
  $('resultReportIssue').classList.add('hidden');
  const authored = currentCampaign
    ? CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign)
    : currentChallenge ? CHALLENGES.find((c) => c.id === currentChallenge) : null;
  try {
    battleJournal = createBattleJournal(game, {
      resumed,
      mode: currentCampaign ? 'campaign' : currentChallenge ? 'challenge' : 'skirmish',
      id: currentCampaign || currentChallenge,
      name: authored?.name || `${game.map.name} skirmish`,
    });
  } catch { reportFault = true; }
}
function sampleBattleReport() {
  if (!battleJournal) return;
  try { battleJournal.sample(game); }
  catch { battleJournal = null; reportFault = true; }
}
function finishBattleReport() {
  hasLastResult = true;
  $('lastResult').classList.remove('hidden');
  try {
    if (!battleJournal || reportFault) throw new Error('Report observation unavailable');
    const targets = currentCampaign ? getCampaignTargets(game, currentCampaign)
      : currentChallenge ? getChallengeTargets(game, currentChallenge).map((target) => ({...target,kind:'destroy',side:1})) : [];
    const report = battleJournal.finish(game, {objectiveOutcome, targets});
    const markup = renderBattleReport(report);
    lastBattleReport = report;
    $('resultReport').innerHTML = markup;
    $('resultReport').classList.remove('hidden');
  } catch {
    lastBattleReport = null;
    $('resultReport').classList.add('hidden');
    $('resultReportIssue').textContent = 'The detailed report is unavailable. Your battle result is still valid.';
    $('resultReportIssue').classList.remove('hidden');
  }
  $('resultBody').scrollTop = 0;
}
function revealBattleReport(report, focus = false) {
  requestAnimationFrame(() => {
    if (!report?.open || report !== $('resultReport').querySelector('details.battle-report') || $('resultModal').classList.contains('hidden')) return;
    const body = $('resultBody'), summary = report.querySelector('summary');
    if (!summary) return;
    // Keep the action footer fixed and move only the result's single scroll area.
    // A native disclosure click retains its focus; explicit reopening may focus it.
    const offset = summary.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + offset));
    if (focus) summary.focus({preventScroll:true});
  });
}
$('resultReport').addEventListener('toggle', (event) => {
  if (event.target.matches('details.battle-report') && event.target.open) revealBattleReport(event.target);
}, true);
$('lastResult').onclick = () => {
  if (!hasLastResult || recoveryHold || profileGate) return;
  retryHistorySave();
  $('welcome').classList.add('hidden');
  $('resultModal').classList.remove('hidden');
  const report = $('resultReport').querySelector('details');
  if (report) {
    report.open = true;
    revealBattleReport(report, true);
  }
};
$('resultReport').addEventListener('click', (event) => {
  if (!event.target.closest('[data-report-download]') || !lastBattleReport) return;
  const status = $('resultReport').querySelector('[data-report-status]');
  let url, anchor;
  try {
    if (location.protocol === 'ironroot:') throw new Error('Report downloads are not enabled in the desktop shell yet. Use the browser edition.');
    const text = exportBattleReport(lastBattleReport);
    url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
    anchor = document.createElement('a');
    anchor.href = url;
    const name = (lastBattleReport.context.id || lastBattleReport.context.mode).replace(/[^a-z0-9-]/gi,'-').slice(0,40);
    anchor.download = `ironroot-report-${name}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(anchor);
    anchor.click();
    status.textContent = 'Report download started. Check your browser’s downloads to keep it.';
  } catch (error) {
    status.textContent = error.message || 'The report download could not start. The report remains available on this page.';
  } finally {
    anchor?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
});
$('start').onclick = () => start();
function showTitle() {
  if (recoveryHold || profileGate) {
    showRecoverySettings();
    return;
  }
  padHud = false;
  started = false;
  paused = false;
  cancel();
  renderer.vfx?.reset();
  $('resultModal').classList.add('hidden');
  $('pauseVeil').classList.add('hidden');
  $('welcome').classList.remove('hidden');
  setMode(mode);
  updateResume();
}
$('playAgain').onclick = () => {
  if (currentCampaign && objectiveOutcome?.failed) {
    mode = 'campaign';
    selectedCampaign = currentCampaign;
    start();
    return;
  }
  if (currentChallenge && objectiveOutcome?.failed) {
    mode = 'challenges';
    selectedChallenge = currentChallenge;
    start();
    return;
  }
  if (currentCampaign) {
    mode = 'campaign';
    const overview = getCampaignOverview(campaignProgress);
    selectedCampaign = overview.nextMissionId || currentCampaign;
    selectedChapter = CAMPAIGN_MISSIONS.find(
      (m) => m.id === selectedCampaign,
    ).chapterId;
  } else if (currentChallenge) mode = 'challenges';
  battleSession.remove();
  showTitle();
};
$('resultMenu').onclick = showTitle;
$('inspectBattle').onclick = () => {
  $('resultModal').classList.add('hidden');
  toast('Battle ended. Open the field guide or return to the menu.');
  pauseControl('menu');
  $('pause').onclick = showTitle;
};
function persistProgress() {
  if (recoveryHold || profileGate || !profileSession.status().canWrite) {
    progressDirty = true;
    return false;
  }
  campaignProgress = mergeCampaignProgress(
    campaignProgress,
    readCampaignProgress(storage),
  );
  try {
    const latest = JSON.parse(storage.get(TRIALS) || '{}');
    for (const c of CHALLENGES) {
      const record = latest?.[c.id];
      if (
        record?.completed === true &&
        Number.isFinite(record.bestTime) &&
        record.bestTime > 0 &&
        record.bestTime <= c.timeLimit + 0.25
      ) {
        trialRecords[c.id] = {
          completed: true,
          bestTime: Math.min(
            trialRecords[c.id]?.bestTime ?? Infinity,
            record.bestTime,
          ),
        };
      }
    }
  } catch {}
  const campaignOK = writeCampaignProgress(storage, campaignProgress),
    trialsOK = storage.set(TRIALS, JSON.stringify(trialRecords));
  progressDirty = !(campaignOK && trialsOK);
  return !progressDirty;
}
function save() {
  if (recoveryHold || profileGate) return false;
  if (
    !started ||
    game.state.winner !== null ||
    objectiveOutcome ||
    typeof game.serialize !== 'function'
  )
    return false;
  const saveStatus = battleSession.status();
  if (saveStatus === 'stale') return false;
  const ok =
    saveStatus === 'current' &&
    writeBattle(battleSession, SAVE, game, currentChallenge, currentCampaign);
  if (!ok && !saveWarning) {
    toast(
      'Autosave unavailable. Your battle is still running, but keep this page open.',
    );
    saveWarning = true;
  }
  if (ok) saveWarning = false;
  return ok;
}
function updateResume() {
  let button = $('resumeSaved');
  if (!button) {
    button = document.createElement('button');
    button.id = 'resumeSaved';
    button.className = 'resume-saved';
    $('start').after(button);
  }
  let valid = null,
    cid = null,
    mid = null,
    error = false;
  try {
    const raw = storage.get(SAVE);
    if (raw && typeof Game.restore === 'function') {
      const data = JSON.parse(raw);
      if (data.format === 'ironroot-save') {
        if (![1, 2].includes(data.version)) throw Error('Invalid version');
        cid = data.challengeId ?? null;
        mid = data.campaignId ?? null;
        if (
          (cid && mid) ||
          (cid !== null && !CHALLENGES.some((c) => c.id === cid)) ||
          (mid !== null && !CAMPAIGN_MISSIONS.some((m) => m.id === mid)) ||
          (mid && !isMissionUnlocked(campaignProgress, mid))
        )
          throw Error('Invalid mission');
        valid = Game.restore(data.game);
      } else valid = Game.restore(data);
      const authored = mid
        ? CAMPAIGN_MISSIONS.find((m) => m.id === mid)
        : cid ? CHALLENGES.find((c) => c.id === cid) : null;
      if (authored && valid.map.id !== (authored.mapId || 'classic'))
        throw Error('Saved mission battlefield does not match its briefing');
      if (valid.state.winner !== null) throw Error('Battle ended');
    }
  } catch {
    valid = null;
    error = true;
  }
  $('saveStatus').classList.toggle('hidden', !error);
  $('saveStatus').textContent = error
    ? 'The saved battle could not be loaded. Starting a new battle will replace it.'
    : '';
  button.classList.toggle('hidden', !valid);
  if (valid) {
    const name = mid
      ? `MISSION · ${CAMPAIGN_MISSIONS.find((m) => m.id === mid).name.toUpperCase()}`
      : cid
        ? `TRIAL · ${CHALLENGES.find((c) => c.id === cid).name.toUpperCase()}`
        : valid.map.id === 'classic' ? 'BATTLE' : valid.map.name.toUpperCase();
    button.textContent = `RESUME ${name} · ${timeText(valid.state.time)}`;
    button.onclick = () => start(valid, cid, mid);
  }
}

updateResume();
function finish() {
  if (resultShown || (game.state.winner === null && !objectiveOutcome)) return;
  resultShown = true;
  cancel();
  const draw = game.state.winner === 'draw',
    authored = currentCampaign || currentChallenge,
    won = authored ? objectiveOutcome?.completed : game.state.winner === 0;
  const mission =
      currentCampaign &&
      CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign),
    trial =
      currentChallenge && CHALLENGES.find((c) => c.id === currentChallenge);
  $('resultEyebrow').textContent = mission
    ? won
      ? 'A WATCHFIRE BURNS BRIGHTER'
      : 'THE ROAD IS NOT LOST'
    : trial
      ? won
        ? 'FIELD TRIAL COMPLETE'
        : 'ADAPT AND TRY AGAIN'
      : draw
        ? 'NO CITADEL LEFT STANDING'
        : won
          ? 'THE FRONTIER IS YOURS'
          : 'EVERY DEFEAT IS A LESSON';
  $('resultTitle').textContent = mission
    ? won
      ? 'MISSION COMPLETE'
      : 'MISSION FAILED'
    : trial
      ? won
        ? 'COMPLETE'
        : 'TRIAL FAILED'
      : draw
        ? 'DRAW'
        : won
          ? 'VICTORY'
          : 'DEFEAT';
  document
    .querySelector('.result')
    .classList.toggle('campaign-result', !!mission);
  $('resultSigil').textContent = won ? '⚑' : '♜';
  $('resultCopy').textContent = mission
    ? won
      ? mission.victoryText
      : `${mission.name}: ${objectiveOutcome.label}`
    : trial
      ? `${trial.name}: ${objectiveOutcome.label}`
      : draw
        ? 'Both citadels fell together. Neither commander claims the frontier.'
        : won
          ? 'Your army broke the enemy citadel.'
          : 'Your citadel has fallen. Rebuild, adapt, return.';
  $('resultTime').textContent = timeText(game.state.time);
  $('resultKills').textContent = game.state.stats.kills[0];
  $('resultBuilt').textContent = game.state.stats.built[0];
  finishBattleReport();
  $('resultObjectives').classList.toggle('hidden', !mission);
  $('resultObjectives').textContent = '';
  if (mission) {
    const stars = document.createElement('div');
    stars.className = 'result-stars';
    stars.textContent =
      '★'.repeat(objectiveOutcome.stars) +
      '☆'.repeat(3 - objectiveOutcome.stars);
    $('resultObjectives').append(stars);
    for (const medal of objectiveOutcome.medals) {
      const p = document.createElement('p');
      p.textContent = `${medal.earned ? '✓' : '○'} ${medal.label}`;
      $('resultObjectives').append(p);
    }
  }
  $('playAgain').innerHTML = mission
    ? (won ? 'CONTINUE CAMPAIGN' : 'RETRY MISSION') + ' <span>→</span>'
    : trial
      ? (won ? 'MORE FIELD TRIALS' : 'RETRY FIELD TRIAL') + ' <span>→</span>'
      : 'FIGHT ANOTHER DAY <span>→</span>';
  $('resultModal').classList.remove('hidden');
  const completion = battleSession.captureResult();
  completion.remove();
  sound(won ? 'win' : 'lose');
  historySession.retain({
    won,
    draw,
    challengeId: currentChallenge,
    campaignId: currentCampaign,
    difficulty: game.difficulty,
    ...(game.map.id !== 'classic' ? { mapId: game.map.id } : {}),
    time: game.state.time,
    kills: game.state.stats.kills[0],
    built: game.state.stats.built[0],
    date: new Date().toISOString(),
  }, { ownership: completion.status, onSaved: completion.remove });
  retryHistorySave();
  if (trial && won) {
    const old = trialRecords[currentChallenge];
    trialRecords[currentChallenge] = {
      completed: true,
      bestTime: Math.min(old?.bestTime || Infinity, game.state.time),
    };
    persistProgress();
    renderChallenge();
  }
  if (mission && won) {
    campaignProgress = recordCampaignResult(
      campaignProgress,
      currentCampaign,
      game,
    );
    persistProgress();
    renderCampaign();
  }
  $('progressSaveWarning').classList.toggle('hidden', !progressDirty);
  syncDialogs();
  requestAnimationFrame(keepDialogFocus);
}
let pointer = null;
const activePointers = new Set();
let multiTouch = false;
function localPoint(e) {
  const r = $('battle').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
$('battle').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) {
    multiTouch = true;
    pointer = null;
    ui.dragging = false;
    return;
  }
  const p = localPoint(e);
  pointer = { id: e.pointerId, x: p.x, y: p.y, lastX: p.x, moved: false };
  $('battle').setPointerCapture(e.pointerId);
  ui.pointer = renderer.screenToWorld(p.x, p.y);
});
$('battle').addEventListener('pointermove', (e) => {
  const p = localPoint(e);
  ui.pointer = renderer.screenToWorld(p.x, p.y);
  if (!pointer || pointer.id !== e.pointerId) return;
  if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > 8) pointer.moved = true;
  if (pointer.moved) {
    renderer.pan(p.x - pointer.lastX);
    ui.dragging = true;
    follow = false;
    $('battle').classList.add('dragging');
  }
  pointer.lastX = p.x;
});
$('battle').addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  if (multiTouch) {
    if (activePointers.size === 0) multiTouch = false;
    pointer = null;
    ui.dragging = false;
    $('battle').classList.remove('dragging');
    return;
  }
  if (!pointer || pointer.id !== e.pointerId) return;
  const p = localPoint(e),
    w = renderer.screenToWorld(p.x, p.y);
  const moved = pointer.moved;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
  if (moved || !canInteract()) return;
  activateBattlePoint(w);
});
function activateBattlePoint(w) {
  if (!canInteract()) return;
  if (ui.build) {
    const bounds = buildBounds(game.map, 0);
    if (
      w.x < bounds.minX - 20 ||
      w.x > bounds.maxX + 70 ||
      w.y < bounds.minY - 15 ||
      w.y > bounds.maxY + 20
    ) {
      toast('Build within your own frontier. Drag back toward your citadel.');
      sound('error');
      return;
    }
    const snap = renderer.snap(w),
      result = game.build(ui.build, snap.x, snap.y);
    if (result.ok) {
      sound('build');
      toast(
        `${BUILDINGS[ui.build].name} raised. ${BUILDINGS[ui.build].unit ? 'First troops in a moment.' : 'Your frontier grows.'}`,
      );
      if (game.state.gold[0] < BUILDINGS[ui.build].cost) {
        ui.build = null;
        syncChoice();
      }
    } else {
      toast(result.reason);
      sound('error');
    }
  } else if (ui.spell) {
    const result = game.cast(w.x, w.y);
    if (result.ok) {
      sound('strike');
      ui.spell = false;
      syncChoice();
      toast('Rally strike unleashed.');
    } else {
      toast(result.reason);
      sound('error');
    }
  } else {
    const b = game.state.buildings
      .filter((b) => b.side === 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y),
      )[0];
    ui.selected = b && Math.hypot(b.x - w.x, b.y - w.y) < 95 ? b.id : null;
    requestAnimationFrame(updateSelection);
    if (ui.selected) sound('click');
  }
}
function resetBattleGesture() {
  activePointers.clear();
  multiTouch = false;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
}
$('battle').addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) multiTouch = false;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
});
$('battle').addEventListener('lostpointercapture', (e) => {
  if (pointer?.id === e.pointerId) resetBattleGesture();
});
$('battle').addEventListener('pointerleave', () => {
  if (!pointer) ui.pointer = null;
});
$('battle').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.pan(
      -(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY),
    );
    follow = false;
  },
  { passive: false },
);
// Native click makes the whole canvas a touch-adjustment target, including
// its edges beside Home/Front. Release activation also passes through the
// document's scope guard, so a held touch cannot cross into a new dialog.
$('minimap').addEventListener('click', (e) => {
  const r = $('minimap').getBoundingClientRect();
  renderer.camera = ((e.clientX - r.left) / r.width) * game.map.width;
  renderer.clampCamera();
  follow = false;
});
window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
  if (e.code === 'Escape') {
    if (!$('backupModal').classList.contains('hidden')) hideBackup();
    else if (!$('settingsModal').classList.contains('hidden')) hideSettings();
    else if (!$('helpModal').classList.contains('hidden')) hideHelp();
    else if (!$('resultModal').classList.contains('hidden') && $('resultReport').querySelector('details')?.open) {
      const report = $('resultReport').querySelector('details');
      report.open = false;
      report.querySelector('summary').focus();
    } else cancel();
  }
  if (
    !started ||
    !$('backupModal').classList.contains('hidden') ||
    !$('settingsModal').classList.contains('hidden') ||
    !$('helpModal').classList.contains('hidden') ||
    !$('resultModal').classList.contains('hidden')
  )
    return;
  if (e.code === 'Space' && !nativeSpaceTarget(e.target)) {
    e.preventDefault();
    pause(!paused);
  }
  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    renderer.pan(75);
    follow = false;
  }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    renderer.pan(-75);
    follow = false;
  }
  if (e.code === 'KeyR') $('rally').click();
  if (/^Digit[1-7]$/.test(e.code)) {
    const key = Object.keys(BUILDINGS)[Number(e.code.slice(-1)) - 1];
    if (key) selectBuild(key);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.setScene('paused');
  else { retryHistorySave(); retryPreferences(); }
  if (document.hidden && started && !paused && game.state.winner === null)
    pause(true);
  last = performance.now();
});
window.addEventListener('beforeunload', (e) => {
  if (allowProfileReload) return;
  const profile = profileSession.status();
  if (
    recoveryHold ||
    profile.reloadRequired ||
    profile.recoveryRequired ||
    profile.phase === 'restoring'
  ) {
    e.preventDefault();
    e.returnValue = '';
    return;
  }
  if (progressDirty) persistProgress();
  retryHistorySave();
  retryPreferences();
  if (
    historySession.pendingCount() || preferenceSession.dirty() ||
    progressDirty ||
    (started &&
      game.state.winner === null &&
      !objectiveOutcome &&
      battleSession.status() !== 'stale' &&
      !save())
  ) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('storage', (event) => {
  syncProfileSafety();
  if (event.key === PROFILE_MARKER_KEY || recoveryHold || profileGate) return;
  if (event.key === 'ironroot.campaign.v1') {
    const latest = readCampaignProgress(storage);
    campaignProgress = progressDirty
      ? mergeCampaignProgress(campaignProgress, latest)
      : latest;
    if (!started) renderCampaign();
    return;
  }
  if (event.key !== SAVE) return;
  if (
    started &&
    !battleSession.isCurrent() &&
    game.state.winner === null &&
    !objectiveOutcome
  ) {
    paused = true;
    $('pauseVeil').classList.remove('hidden');
    pauseControl('resume');
    toast(
      'Another tab saved a newer battle. Return to title to resume it; this tab will not overwrite it.',
    );
  }
  if (!started) updateResume();
});
new ResizeObserver(() => renderer.resize()).observe($('battlefield'));
new ResizeObserver(positionToast).observe($('objectiveHUD'));
new ResizeObserver(() => syncChoice()).observe($('buildCards'));
let hudTimer = 0,
  lastProfileCheck = 0;
function updateHUD() {
  const s = game.state;
  $('gold').textContent = Math.floor(s.gold[0]);
  $('income').textContent =
    `+${s.income[0].toFixed(s.income[0] % 1 ? 1 : 0)} /s`;
  const army = s.units.filter((u) => u.side === 0).length;
  $('army').textContent = army >= 70 ? '70/70' : army;
  $('army').title = `${army} / 70 army capacity`;
  $('time').textContent = timeText(s.time);
  for (const [i, prefix] of [
    [0, 'your'],
    [1, 'enemy'],
  ]) {
    const hp = Math.ceil((s.bases[i].hp / s.bases[i].maxHp) * 100);
    $(prefix + 'Hp').style.width = hp + '%';
    $(prefix + 'HpText').textContent = hp + '%';
  }
  $('phase').innerHTML =
    s.time > 420
      ? 'CITADELS CRUMBLING<small>BREAK THE ENEMY FIRST</small>'
      : s.overtime
        ? 'OVERTIME<small>FASTER WAVES · STRONGER SIEGE</small>'
        : `${game.map.id === 'classic' ? 'THE LONG REACH' : game.map.name.toUpperCase()}<small>${game.map.lanes.length === 2 ? 'TWO' : 'THREE'} LANES · ${game.map.buildLimit} SITES</small>`;
  document
    .querySelectorAll('.build-card')
    .forEach((b) =>
      b.classList.toggle(
        'unaffordable',
        s.gold[0] < BUILDINGS[b.dataset.type].cost,
      ),
    );
  $('rallyCost').innerHTML =
    s.spellCooldown[0] > 0
      ? `${Math.ceil(s.spellCooldown[0])}s <em>Recharging</em>`
      : `◆ ${SPELL.cost} <em>${SPELL.cooldown}s cooldown</em>`;
  $('rally').style.opacity = s.spellCooldown[0] > 0 ? '.55' : '1';
  $('objectiveHUD').classList.toggle(
    'hidden',
    !currentChallenge && !currentCampaign,
  );
  if (currentChallenge || currentCampaign) {
    const authored = currentCampaign
        ? CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign)
        : CHALLENGES.find((c) => c.id === currentChallenge),
      outcome =
        objectiveOutcome ||
        (currentCampaign
          ? evaluateCampaignMission(game, currentCampaign)
          : evaluateChallenge(game, currentChallenge));
    $('phase').textContent = authored.name.toUpperCase();
    const label = document.createElement('small');
    label.textContent = currentCampaign ? 'CAMPAIGN' : 'FIELD TRIAL';
    $('phase').append(label);
    $('objectiveProgress').textContent =
      currentCampaign && !outcome.completed && !outcome.failed
        ? outcome.objectives
            .map((o) =>
              o.type === 'destroy'
                ? `${o.value}/${o.target} targets`
                : o.type === 'protect'
                  ? `${o.value}/${o.target} protected`
                  : o.type === 'income'
                    ? `${o.value.toFixed(1)}/${o.target} gold/s`
                    : o.type === 'health'
                      ? `Citadel ${Math.ceil(o.value)} / ${o.target}+`
                      : o.type === 'citadel'
                        ? `Enemy citadel ${Math.ceil(o.target - o.value)} HP`
                        : `${Math.floor(o.value)}/${o.target}s held`,
            )
            .join(' · ')
        : outcome.label;
    $('objectiveTime').textContent =
      `${timeText(Math.ceil(Math.max(0, authored.timeLimit - s.time)))} remaining`;
  }
  updateSelection();
}
let heardEffects = new WeakSet(),
  heardProjectiles = new WeakSet();
function updateAudio() {
  const ended = game.state.winner !== null || objectiveOutcome;
  audio.setScene(
    document.hidden || paused
      ? 'paused'
      : !started
        ? 'menu'
        : ended
          ? game.state.winner === 0 || objectiveOutcome?.completed
            ? 'victory'
            : 'defeat'
          : 'battle',
  );
  if (!started || paused || ended) return;
  const s = game.state;
  audio.setIntensity(
    Math.min(
      1,
      0.2 +
        s.units.length / 160 +
        (s.overtime ? 0.25 : 0) +
        (s.bases[0].hp / s.bases[0].maxHp < 0.35 ? 0.2 : 0),
    ),
  );
  const half = renderer.width / (2 * renderer.scale);
  for (const e of s.effects) {
    if (heardEffects.has(e)) continue;
    heardEffects.add(e);
    if (Math.abs(e.x - renderer.camera) > half + 100) continue;
    const name = {
      hit: 'sword',
      blast: 'siege',
      magic: 'magic',
      volley: 'strike',
      death: 'collapse',
    }[e.type];
    if (name)
      sound(name, {
        pan: Math.max(-1, Math.min(1, (e.x - renderer.camera) / half)),
        volume: e.type === 'death' && e.radius < 30 ? 0.18 : 0.48,
      });
  }
  for (const p of s.projectiles) {
    if (heardProjectiles.has(p)) continue;
    heardProjectiles.add(p);
    if (Math.abs(p.x - renderer.camera) > half + 100) continue;
    if (['archer', 'tower', 'gryphon'].includes(p.type))
      sound(p.type === 'gryphon' ? 'gryphon' : 'arrow', {
        pan: Math.max(-1, Math.min(1, (p.x - renderer.camera) / half)),
        volume: 0.22,
      });
  }
}

function frame(now) {
  if (now - lastProfileCheck > 250) {
    syncProfileSafety();
    lastProfileCheck = now;
  }
  updateController(now);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (started && !paused && game.state.winner === null && !objectiveOutcome) {
    if (currentCampaign || currentChallenge) {
      const authored = currentCampaign
        ? CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign)
        : CHALLENGES.find((c) => c.id === currentChallenge);
      const outcome = advanceObjectiveBattle(
        game,
        dt * speed,
        (g) =>
          currentCampaign
            ? evaluateCampaignMission(g, currentCampaign)
            : evaluateChallenge(g, currentChallenge),
        authored.timeLimit,
      );
      if (outcome.completed || outcome.failed) objectiveOutcome = outcome;
    } else game.update(dt * speed);
    sampleBattleReport();
    if (follow)
      renderer.camera +=
        (game.state.frontline - renderer.camera) * Math.min(1, dt * 3);
    saveTimer += dt;
    if (saveTimer > 5) {
      save();
      saveTimer = 0;
    }
    finish();
  }
  updateAudio();
  ui.paused =
    paused || !started || game.state.winner !== null || !!objectiveOutcome;
  const missionTargets = currentCampaign
    ? getCampaignTargets(game, currentCampaign)
    : [];
  ui.targets = currentCampaign
    ? missionTargets.filter((t) => t.building).map((t) => t.building.id)
    : currentChallenge
      ? getChallengeTargets(game, currentChallenge)
          .filter((t) => t.building)
          .map((t) => t.building.id)
      : [];
  ui.protectedTargets = missionTargets
    .filter((t) => t.kind === 'protect' && t.building)
    .map((t) => t.building.id);
  renderer.draw(game, ui, dt);
  hudTimer += dt;
  if (hudTimer > 0.1) {
    updateHUD();
    hudTimer = 0;
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
  requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);

// Preview stays live; production supports an offline shell after the first visit.
if (
  'serviceWorker' in navigator &&
  location.protocol === 'https:' &&
  !['localhost', '127.0.0.1'].includes(location.hostname)
) {
  window.addEventListener('load', () =>
    navigator.serviceWorker
      .register('./service-worker.js', { updateViaCache: 'none' })
      .catch(() => {}),
  );
}

function renderChallenge() {
  const challenge = CHALLENGES.find((c) => c.id === selectedChallenge);
  $('challengeChoices').innerHTML = '';
  for (const [index, c] of CHALLENGES.entries()) {
    const button = document.createElement('button');
    button.className = c.id === selectedChallenge ? 'active' : '';
    button.innerHTML = `<span>${trialRecords[c.id]?.completed ? '✓' : String(index + 1).padStart(2, '0')}</span><b>${c.name}</b>`;
    button.onclick = () => {
      selectedChallenge = c.id;
      renderChallenge();
      $('challengeChoices').querySelector('.active')?.focus();
      sound('click');
    };
    $('challengeChoices').append(button);
  }
  $('challengeName').textContent = challenge.subtitle;
  $('challengeDescription').textContent = challenge.description;
  $('challengeObjective').textContent = challenge.objective;
  $('challengeHint').textContent = challenge.hint;
  $('challengeBriefing').innerHTML = challenge.briefing
    .map((t) => `<li>${t}</li>`)
    .join('');
  $('challengeMedal').textContent = trialRecords[challenge.id]?.completed
    ? `✓ Best ${timeText(trialRecords[challenge.id].bestTime)}`
    : '';
}
function setMode(value) {
  mode = value;
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('skirmishConfig').classList.toggle('hidden', mode !== 'skirmish');
  $('challengeConfig').classList.toggle('hidden', mode !== 'challenges');
  $('campaignConfig').classList.toggle('hidden', mode !== 'campaign');
  document
    .querySelector('.welcome')
    .classList.toggle('challenge-mode', mode === 'challenges');
  document
    .querySelector('.welcome')
    .classList.toggle('campaign-mode', mode === 'campaign');
  $('start').disabled = false;
  $('start').innerHTML =
    mode === 'campaign'
      ? 'BEGIN MISSION <span>→</span>'
      : mode === 'challenges'
        ? 'START FIELD TRIAL <span>→</span>'
        : 'ENTER THE FRONTIER <span>→</span>';
  renderChallenge();
  renderCampaign();
}
for (const button of document.querySelectorAll('[data-mode]'))
  button.onclick = () => {
    setMode(button.dataset.mode);
    sound('click');
  };
function revealCampaignChapter() {
  const strip = $('campaignChapters'), active = strip.querySelector('.active');
  if (mode !== 'campaign' || !active || strip.clientWidth <= 0) return;
  const frame = strip.getBoundingClientRect(), item = active.getBoundingClientRect();
  // Only move this horizontal strip. scrollIntoView also moves the briefing/page.
  if (item.left < frame.left) strip.scrollLeft += item.left - frame.left;
  else if (item.right > frame.right) strip.scrollLeft += item.right - frame.right;
}
function renderCampaign() {
  const overview = getCampaignOverview(campaignProgress),
    mission =
      CAMPAIGN_MISSIONS.find((m) => m.id === selectedCampaign) ||
      CAMPAIGN_MISSIONS[0],
    chapter =
      CAMPAIGN_CHAPTERS.find((c) => c.id === selectedChapter) ||
      CAMPAIGN_CHAPTERS[0];
  $('campaignProgressText').textContent =
    `${overview.cleared}/${overview.total} missions · ${overview.stars}/${overview.maxStars} stars`;
  $('campaignCount').textContent = String(overview.total);
  $('campaignChapters').textContent = '';
  for (const c of overview.chapters) {
    const button = document.createElement('button');
    button.dataset.chapter = c.id;
    button.className = c.id === chapter.id ? 'active' : '';
    button.innerHTML = `<span>CHAPTER ${c.number} · ${c.stars}/${c.maxStars} ★</span><b>${c.name}</b>`;
    button.onclick = () => {
      selectedChapter = c.id;
      const candidates = overview.missions.filter((m) => m.chapterId === c.id);
      selectedCampaign = (
        candidates.find((m) => m.unlocked && !m.completed) || candidates[0]
      ).id;
      renderCampaign();
      $('campaignChapters').querySelector(`[data-chapter="${c.id}"]`)?.focus();
    };
    $('campaignChapters').append(button);
  }
  $('campaignChapterTitle').textContent = chapter.subtitle;
  $('campaignChapterStory').textContent = overview.chapters.find(
    (c) => c.id === chapter.id,
  ).completed
    ? chapter.epilogue
    : chapter.description;
  $('campaignMissions').textContent = '';
  for (const m of overview.missions.filter((m) => m.chapterId === chapter.id)) {
    const button = document.createElement('button');
    button.dataset.mission = m.id;
    button.className = [
      m.id === mission.id ? 'active' : '',
      !m.unlocked ? 'locked' : '',
      m.completed ? 'complete' : '',
    ].join(' ');
    button.innerHTML = `<span class="mission-number">${String(m.number).padStart(2, '0')}</span><span><b>${m.name}</b><small>${m.completed ? '★'.repeat(m.record.stars) + '☆'.repeat(3 - m.record.stars) : m.unlocked ? 'READY TO PLAY' : 'LOCKED'}</small></span>`;
    button.onclick = () => {
      selectedCampaign = m.id;
      renderCampaign();
      $('campaignMissions').querySelector(`[data-mission="${m.id}"]`)?.focus();
    };
    $('campaignMissions').append(button);
  }
  $('campaignMissionTitle').textContent = mission.name;
  $('campaignMissionDescription').textContent = mission.description;
  $('campaignSpeaker').textContent = mission.dialogue.speaker;
  $('campaignDialogue').textContent = mission.dialogue.text;
  $('campaignObjective').textContent = mission.objective;
  $('campaignBriefing').innerHTML = mission.briefing
    .map((t) => `<li>${t}</li>`)
    .join('');
  $('campaignHint').textContent = mission.hint;
  $('campaignScoutToggle').textContent = `Scout battlefield · ${getMap(mission.mapId || 'classic').name}`;
  $('campaignScoutReport').innerHTML = renderMissionScouting(mission);
  $('campaignMedals').textContent =
    'Bonus stars: ' + mission.medals.map((m) => m.label).join(' · ');
  const unlocked = isMissionUnlocked(campaignProgress, mission.id);
  $('campaignUnlock').textContent = unlocked
    ? mission.reward
    : 'Complete ' +
      mission.prerequisites
        .map((id) => CAMPAIGN_MISSIONS.find((m) => m.id === id).name)
        .join(' and ') +
      ' to unlock.';
  $('campaignUnlock').classList.toggle('locked', !unlocked);
  if (mode === 'campaign') {
    $('start').disabled = !unlocked;
    $('start').innerHTML =
      (unlocked ? 'BEGIN MISSION' : 'MISSION LOCKED') + ' <span>→</span>';
    requestAnimationFrame(revealCampaignChapter);
  }
}
renderChallenge();
renderCampaign();
new ResizeObserver(revealCampaignChapter).observe($('campaignChapters'));
let settingsWasPaused = false;
function showSettings() {
  settingsWasPaused = paused;
  if (started && game.state.winner === null && !objectiveOutcome) {
    paused = true;
    $('pauseVeil').classList.add('hidden');
  }
  syncSettings();
  $('settingsModal').classList.remove('hidden');
}
function hideSettings() {
  if (recoveryHold || profileGate) {
    updateRecoveryUI();
    return;
  }
  invalidateImportRead();
  $('settingsModal').classList.add('hidden');
  if (started && game.state.winner === null && !objectiveOutcome)
    pause(settingsWasPaused);
}
function syncSettings() {
  $('audioEnabled').checked = soundOn;
  $('musicEnabled').checked = preferences.music;
  $('sfxEnabled').checked = preferences.sfx;
  $('masterVolume').value = Math.round(preferences.volume * 100);
  $('volumeValue').textContent = Math.round(preferences.volume * 100) + '%';
  $('reduceMotion').checked = preferences.reducedMotion;
  $('effectQuality').value = preferences.quality;
  updatePreferenceSaveStatus();
  const history = historySession.read();
  if (history.ok) { knownHistory = history.rows; knownHistoryAvailable = true; }
  updateHistorySaveStatus(history);
  const rows = historySession.view(history.ok ? history.rows : knownHistory).slice(0, 5);
  $('battleHistory').textContent = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.textContent = history.ok ? 'Your completed battles will appear here.' : 'No previously verified history is available in this tab.';
    $('battleHistory').append(p);
  }
  if (!history.ok && rows.length) {
    const notice = document.createElement('p');
    notice.textContent = 'Showing this tab’s retained results; stored history could not be checked.';
    $('battleHistory').append(notice);
  }
  for (const row of rows) {
    const p = document.createElement('p');
    const label = row.campaignId
      ? CAMPAIGN_MISSIONS.find((m) => m.id === row.campaignId)?.name ||
        'Campaign'
      : row.challengeId
        ? CHALLENGES.find((c) => c.id === row.challengeId)?.name ||
          'Field trial'
        : typeof row.mapId === 'string' && Object.hasOwn(MAPS, row.mapId)
          ? `Skirmish · ${MAPS[row.mapId].name}`
          : 'Skirmish';
    p.textContent = `${row.draw ? 'DRAW' : row.won ? 'VICTORY' : 'DEFEAT'} · ${label} · ${timeText(Number.isFinite(row.time) ? row.time : 0)}`;
    $('battleHistory').append(p);
  }
}
$('settings').onclick = showSettings;
$('welcomeSettings').onclick = showSettings;
$('pauseSettings').onclick = showSettings;
$('closeSettings').onclick = hideSettings;
$('settingsDone').onclick = hideSettings;
$('audioEnabled').onchange = () => {
  soundOn = $('audioEnabled').checked;
  if (soundOn) initAudio();
  setSound();
  savePreferences();
};
$('musicEnabled').onchange = () => {
  preferences.music = $('musicEnabled').checked;
  audio.setMusicEnabled(preferences.music);
  if (preferences.music && soundOn) initAudio();
  savePreferences();
};
$('sfxEnabled').onchange = () => {
  preferences.sfx = $('sfxEnabled').checked;
  audio.setSfxEnabled(preferences.sfx);
  if (preferences.sfx && soundOn) {
    initAudio();
    sound('click');
  }
  savePreferences();
};
$('masterVolume').oninput = () => {
  preferences.volume = Number($('masterVolume').value) / 100;
  audio.setVolume(preferences.volume);
  $('volumeValue').textContent = Math.round(preferences.volume * 100) + '%';
  savePreferences();
};
$('reduceMotion').onchange = () => {
  preferences.reducedMotion = $('reduceMotion').checked;
  renderer.reducedMotion = preferences.reducedMotion;
  renderer.vfx?.setPreferences({
    reducedMotion: preferences.reducedMotion,
    quality: preferences.quality,
  });
  savePreferences();
};
$('effectQuality').onchange = () => {
  preferences.quality = $('effectQuality').value;
  renderer.vfx?.setPreferences({
    reducedMotion: preferences.reducedMotion,
    quality: preferences.quality,
  });
  savePreferences();
};
// Dialog focus never escapes into a live battlefield behind the overlay.
const dialogLayers = [
  $('welcome'),
  $('helpModal'),
  $('settingsModal'),
  $('resultModal'),
  $('backupModal'),
];
let activeDialog = null;
const dialogFocus = new WeakMap();
const inputScope = createInputScopeGuard();
function syncInputScope() {
  const dialog = dialogLayers.findLast((layer) => !layer.classList.contains('hidden'));
  const next = dialog || (!$('pauseVeil').classList.contains('hidden')
    ? 'pause'
    : game.state.winner !== null || objectiveOutcome ? 'ended' : 'battle');
  if (inputScope.setScope(next)) resetBattleGesture();
}
function guardInput(event, check) {
  // Read the DOM too: a scope can change during the same event turn, before
  // the MutationObserver has restored focus/inert state.
  syncInputScope();
  if (!check()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('pointerdown', (event) => {
  syncInputScope();
  inputScope.pointerDown(event);
}, true);
document.addEventListener('pointerup', (event) => {
  guardInput(event, () => inputScope.pointerEnd(event));
}, true);
document.addEventListener('pointercancel', (event) => {
  // Let the original target clean up its own drag/multi-touch state.
  inputScope.pointerEnd(event, true);
}, true);
document.addEventListener('click', (event) => {
  guardInput(event, () => inputScope.click(event));
}, true);
document.addEventListener('keydown', (event) => {
  guardInput(event, () => inputScope.keyDown(event));
}, true);
document.addEventListener('keyup', (event) => {
  guardInput(event, () => inputScope.keyUp(event));
}, true);
window.addEventListener('blur', () => {
  inputScope.interrupt();
  resetBattleGesture();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    inputScope.interrupt();
    resetBattleGesture();
  }
});
new MutationObserver(syncInputScope).observe($('pauseVeil'), {
  attributes: true,
  attributeFilter: ['class'],
});
function controlIsVisible(element) {
  if (element.closest('.hidden,[inert]') || !element.getClientRects().length ||
      getComputedStyle(element).visibility === 'hidden') return false;
  // Chromium can return layout rectangles for closed-details descendants.
  // Only the first summary remains interactive, including through every
  // closed ancestor when disclosures are nested.
  for (let details = element.closest('details:not([open])'); details;
       details = details.parentElement?.closest('details:not([open])')) {
    const summary = details.querySelector(':scope > summary');
    if (!summary?.contains(element)) return false;
  }
  return true;
}
function dialogControls(layer) {
  return [...layer.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')]
    .filter(controlIsVisible);
}
function dialogDefaultFocus(layer) {
  const controls = dialogControls(layer), preferred = layer.querySelector('[data-dialog-focus]');
  return controls.includes(preferred) ? preferred : controls[0];
}
function syncDialogs() {
  syncInputScope();
  const visible = dialogLayers.filter((x) => !x.classList.contains('hidden')),
    next = visible.at(-1) || null;
  document.querySelector('.app').inert = !!next;
  for (const layer of dialogLayers) {
    layer.inert = !!next && layer !== next;
    layer
      .querySelector('[role="dialog"]')
      .setAttribute('aria-hidden', layer === next ? 'false' : 'true');
  }
  if (next === activeDialog) return;
  const previous = activeDialog;
  activeDialog = next;
  if (next) {
    dialogFocus.set(next, document.activeElement);
    const target = dialogDefaultFocus(next);
    target?.focus();
  } else {
    const target = previous && dialogFocus.get(previous);
    if (target?.isConnected && !target.closest('.hidden')) target.focus();
    else $('battle').focus();
  }
}
function keepDialogFocus() {
  if (
    !activeDialog ||
    activeDialog.classList.contains('hidden') ||
    activeDialog.contains(document.activeElement)
  )
    return;
  dialogDefaultFocus(activeDialog)?.focus();
}
for (const event of ['focusin', 'focusout', 'click']) {
  document.addEventListener(event, () => {
    if (activeDialog) requestAnimationFrame(keepDialogFocus);
  });
}
for (const layer of dialogLayers) {
  layer.addEventListener('pointerdown', (event) => {
    if (event.target === layer) event.preventDefault();
  });
}
document.addEventListener(
  'pointerup',
  () => {
    if (activeDialog) requestAnimationFrame(keepDialogFocus);
  },
  true,
);
for (const layer of dialogLayers)
  new MutationObserver(syncDialogs).observe(layer, {
    attributes: true,
    attributeFilter: ['class'],
  });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !activeDialog) return;
  const items = dialogControls(activeDialog);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0],
    last = items.at(-1);
  if (
    e.shiftKey &&
    (document.activeElement === first ||
      !activeDialog.contains(document.activeElement))
  ) {
    e.preventDefault();
    last.focus();
  } else if (
    !e.shiftKey &&
    (document.activeElement === last ||
      !activeDialog.contains(document.activeElement))
  ) {
    e.preventDefault();
    first.focus();
  }
});
syncDialogs();
syncChoice();

// Portable backups stay on the player's device. Nothing is uploaded.
let pendingBackupText = null;
let backupWriteAttempted = false;
function invalidateImportRead() {
  importGeneration++;
  pendingBackupText = null;
  $('backupFile').value = '';
}
function holdRecovery(message, reason = 'rollback') {
  recoveryHold = { message, reason };
  paused = true;
  updateRecoveryUI();
}
function updateRecoveryUI() {
  const status = profileSession.status(),
    held = !!(recoveryHold || profileGate);
  $('profileRecovery').classList.toggle('hidden', !held);
  $('profileRecoveryMessage').textContent =
    recoveryHold?.message || profileGate?.message || '';
  $('profileReload').disabled = !status.canReload || !!pendingFinalizeOutcome;
  $('retryProfileFinish').classList.toggle('hidden', !pendingFinalizeOutcome);
  $('resumeRecovery').classList.toggle(
    'hidden',
    recoveryHold?.reason !== 'storage' ||
      !!profileGate ||
      !!pendingFinalizeOutcome,
  );
  $('resumeRecovery').disabled = !status.canWrite;
  $('exportRecovery').classList.remove('hidden');
  $('exportBackup').disabled = held || !status.canWrite;
  $('settingsDone').disabled = held;
  $('closeSettings').disabled = held;
  const needsRecovery = ['restoring', 'failed', 'invalid'].includes(
    status.phase,
  );
  $('backupRecoveryRow').classList.toggle('hidden', !needsRecovery);
  $('confirmImport').disabled =
    status.reloadRequired ||
    (needsRecovery && !$('backupRecoveryConsent').checked);
}
function showRecoverySettings() {
  paused = true;
  $('resultModal').classList.add('hidden');
  if ($('settingsModal').classList.contains('hidden')) showSettings();
  updateRecoveryUI();
}
function syncProfileSafety() {
  const status = profileSession.status();
  profileGate =
    status.reloadRequired ||
    status.recoveryRequired ||
    ['restoring', 'failed', 'invalid'].includes(status.phase)
      ? status
      : null;
  if (profileGate) {
    paused = true;
    if ($('backupModal').classList.contains('hidden')) showRecoverySettings();
  }
  if (recoveryHold || profileGate) updateRecoveryUI();
}
function reloadProfile() {
  if (!profileSession.status().canReload || pendingFinalizeOutcome) return;
  allowProfileReload = true;
  started = false;
  progressDirty = false;
  paused = true;
  pendingBackupText = null;
  location.reload();
}
$('profileReload').onclick = reloadProfile;
$('resumeRecovery').onclick = () => {
  const status = profileSession.status();
  if (!status.canWrite || profileGate || pendingFinalizeOutcome) return;
  if (started && battleSession.status() === 'stale') {
    holdRecovery(
      'The saved battle changed while storage was unavailable. Export this in-memory session before reloading the saved profile.',
      'profile',
    );
    return;
  }
  recoveryHold = null;
  updateRecoveryUI();
  $('backupStatus').textContent =
    'Storage is available again. Your retained session is still paused.';
};
function downloadBackup(text, suffix = '') {
  if (location.protocol === 'ironroot:')
    throw new Error(
      'File export is not yet enabled in the desktop shell. Use the browser edition for portable backups.',
    );
  const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    ),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ironroot${suffix}-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('exportRecovery').onclick = () => {
  try {
    const battle =
      started && game.state.winner === null && !objectiveOutcome
        ? {
            format: 'ironroot-save',
            version: 2,
            campaignId: currentCampaign,
            challengeId: currentChallenge,
            game: game.serialize(),
          }
        : null;
    // Every domain is explicit, so unavailable/partly replaced local storage is never read.
    const text = createBackup(
      { getItem: () => null },
      {
        campaign: campaignProgress,
        trials: trialRecords,
        settings: preferences,
        history: historySession.view(retainedHistory || knownHistory),
        battle,
      },
    );
    downloadBackup(text, '-retained-session');
    $('backupStatus').textContent =
      'Retained-session download started. It contains this tab’s known progress, settings, retained results and unfinished battle. ' +
      (knownHistoryAvailable
        ? 'History includes records available in this tab, which may omit newer results from other tabs.'
        : 'Stored history was unavailable; only this tab’s retained results are included.');
  } catch (error) {
    $('backupStatus').textContent =
      error.message ||
      'The retained session could not be exported. Keep this page open.';
  }
};
$('exportRetained').onclick = () => $('exportRecovery').onclick();
function hideBackup() {
  invalidateImportRead();
  $('backupModal').classList.add('hidden');
  if (!backupWriteAttempted)
    $('backupStatus').textContent =
      'Import cancelled. Local saves were not changed.';
  if (recoveryHold || profileGate) showRecoverySettings();
}
$('cancelImport').onclick = hideBackup;
$('exportBackup').onclick = () => {
  try {
    const state = profileSession.status();
    if (!state.canWrite || recoveryHold || profileGate)
      throw new Error(
        'Backup unavailable. ' +
          (recoveryHold?.message || state.message) +
          ' Use Export in-memory session to preserve the retained game.',
      );
    const includeBattle = $('backupIncludeBattle').checked,
      options = { includeBattle };
    if (preferenceSession.dirty()) options.settings = preferences;
    if (historySession.pendingCount()) {
      const history = readHistoryState(storage, HISTORY);
      if (!history.ok) throw new Error('Stored history cannot be read safely. Use Export in-memory session to retain this tab’s known results; it is not a complete saved-profile backup.');
      options.history = historySession.view(history.rows);
    }
    if (progressDirty) {
      options.campaign = campaignProgress;
      options.trials = trialRecords;
    }
    if (
      includeBattle &&
      started &&
      game.state.winner === null &&
      !objectiveOutcome &&
      battleSession.isCurrent()
    )
      options.battle = {
        format: 'ironroot-save',
        version: 2,
        campaignId: currentCampaign,
        challengeId: currentChallenge,
        game: game.serialize(),
      };
    downloadBackup(createBackup(localStorage, options));
    $('backupStatus').textContent =
      'Backup download started. Keep the file somewhere safe.';
  } catch (error) {
    $('backupStatus').textContent =
      error.message ||
      'Backup could not be created. Your saves were not changed.';
  }
};
$('importBackup').onclick = () => {
  invalidateImportRead();
  $('backupFile').click();
};
$('backupRecoveryConsent').onchange = updateRecoveryUI;
$('backupFile').onchange = async () => {
  const file = $('backupFile').files?.[0],
    generation = ++importGeneration;
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES)
      throw new Error(
        'This file is too large. Choose an Ironroot backup smaller than 1 MiB.',
      );
    const text = await file.text();
    if (
      generation !== importGeneration ||
      $('settingsModal').classList.contains('hidden')
    )
      return;
    const parsed = parseBackup(text),
      overview = getCampaignOverview(parsed.data.campaign);
    pendingBackupText = text;
    backupWriteAttempted = false;
    const battle = parsed.data.battle,
      battleName = battle
        ? battle.campaignId
          ? CAMPAIGN_MISSIONS.find((m) => m.id === battle.campaignId).name
          : battle.challengeId
            ? CHALLENGES.find((c) => c.id === battle.challengeId).name
            : battle.game.mapId
              ? `Skirmish · ${getMap(battle.game.mapId).name}`
              : 'Skirmish'
        : null;
    $('backupSummary').textContent =
      `${overview.cleared}/${overview.total} campaign missions · ${overview.stars}/${overview.maxStars} stars · ${Object.keys(parsed.data.trials).length}/5 trial records. ${battle ? `Saved battle: ${battleName} at ${timeText(battle.game.state.time)}.` : 'No battle in this file. Your current saved battle will be removed.'}`;
    $('backupImportStatus').textContent = '';
    $('backupRecoveryConsent').checked = false;
    updateRecoveryUI();
    $('backupModal').classList.remove('hidden');
  } catch (error) {
    if (generation !== importGeneration) return;
    pendingBackupText = null;
    $('backupStatus').textContent =
      error.message ||
      'This backup could not be read. Your saves were not changed.';
    $('backupFile').value = '';
  }
};
function finishProfileImport(outcome, originalMessage) {
  pendingFinalizeOutcome = outcome;
  const finalized = profileSession.finishImport({ outcome });
  if (finalized.ok || finalized.code === 'import-ownership-lost')
    pendingFinalizeOutcome = null;
  if (finalized.ok && finalized.phase === 'ready') {
    if (outcome === 'restored') {
      recoveryHold = null;
      profileGate = null;
      reloadProfile();
      return;
    }
    recoveryHold = null;
    profileGate = null;
    retainedHistory = null;
    updateRecoveryUI();
    $('backupImportStatus').textContent = originalMessage || finalized.message;
    $('backupStatus').textContent = originalMessage || finalized.message;
  } else {
    const message = [originalMessage, finalized.message]
      .filter(Boolean)
      .join(' ');
    holdRecovery(message, 'rollback');
    $('backupImportStatus').textContent = message;
    $('backupStatus').textContent = message;
    syncProfileSafety();
  }
}
$('retryProfileFinish').onclick = () => {
  if (pendingFinalizeOutcome)
    finishProfileImport(pendingFinalizeOutcome, recoveryHold?.message);
};
$('confirmImport').onclick = () => {
  if (!pendingBackupText) return;
  const state = profileSession.status(),
    recover = ['restoring', 'failed', 'invalid'].includes(state.phase);
  if (recover && !$('backupRecoveryConsent').checked) return;
  if (state.canWrite && !recoveryHold) {
    const history = readHistoryState(storage, HISTORY);
    if (history.ok) { retainedHistory = history.rows; knownHistoryAvailable = true; }
  }
  backupWriteAttempted = true;
  const begin = profileSession.beginImport({ recover });
  if (!begin.ok) {
    holdRecovery(
      begin.message,
      begin.status.phase === 'unavailable' ? 'storage' : 'profile',
    );
    $('backupImportStatus').textContent = begin.message;
    $('backupStatus').textContent = begin.message;
    syncProfileSafety();
    return;
  }
  const result = restoreBackup(profileSession.importStorage, pendingBackupText);
  const originalSafe =
    result.rollback?.complete === true ||
    (result.rollback?.attempted === false && !result.changedKeys?.length);
  const outcome = result.ok
    ? 'restored'
    : originalSafe
      ? 'rolled-back'
      : 'failed';
  finishProfileImport(outcome, result.message);
};

// Experimental standard-controller adapter. Gameplay uses the same actions as touch.
let padHud = false,
  padActive = false,
  padPoint = { x: renderer.width / 2, y: renderer.height / 2 };
function controllerScope() {
  if (document.hidden || !document.hasFocus())
    return { mode: 'disabled', key: 'inactive', element: null };
  const dialog = [...dialogLayers]
    .reverse()
    .find((layer) => !layer.classList.contains('hidden'));
  if (dialog) return { mode: 'menu', key: dialog.id, element: dialog };
  if (paused) return { mode: 'menu', key: 'pause', element: $('pauseVeil') };
  if (padHud)
    return {
      mode: 'menu',
      key: 'hud',
      element: document.querySelector('.app'),
    };
  return {
    mode: canInteract() ? 'gameplay' : 'menu',
    key: canInteract() ? 'battle' : 'ended',
    element: document.querySelector('.app'),
  };
}
function padControls(scope) {
  return [
    ...(scope.element?.querySelectorAll(
      'button:not([disabled]),a[href],input:not([type="file"]):not([disabled]),select:not([disabled]),summary',
    ) || []),
  ].filter(controlIsVisible);
}
function focusPadControl(control) {
  if (!control) return;
  control.focus();
  control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function controllerNavigate(direction, scope) {
  const controls = padControls(scope),
    active = document.activeElement,
    current = controls.indexOf(active);
  if (
    ['left', 'right'].includes(direction) &&
    active?.matches('input[type="range"]')
  ) {
    active.value = Math.max(
      Number(active.min),
      Math.min(
        Number(active.max),
        Number(active.value) +
          (direction === 'right' ? 1 : -1) * Number(active.step || 1),
      ),
    );
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (['left', 'right'].includes(direction) && active?.matches('select')) {
    active.selectedIndex = Math.max(
      0,
      Math.min(
        active.options.length - 1,
        active.selectedIndex + (direction === 'right' ? 1 : -1),
      ),
    );
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const items = controls.map((el) => ({ rect: el.getBoundingClientRect() }));
  let next = spatialFocusIndex(items, current, direction);
  if (next === current)
    next = nextFocusIndex(
      items,
      current,
      ['left', 'up'].includes(direction) ? -1 : 1,
    );
  focusPadControl(controls[next]);
}
function controllerBack(scope) {
  if (scope.key === 'backupModal') hideBackup();
  else if (scope.key === 'settingsModal') hideSettings();
  else if (scope.key === 'helpModal') hideHelp();
  else if (scope.key === 'pause') pause(false);
  else if (scope.key === 'resultModal' || scope.key === 'ended') showTitle();
  else if (scope.key === 'hud') {
    padHud = false;
    cancel();
    $('battle').focus();
  } else if (scope.mode === 'gameplay') cancel();
}
function handleControllerAction({ action }) {
  const scope = controllerScope();
  if (scope.mode === 'disabled') return;
  const wasActive = padActive;
  padActive = true;
  document.body.classList.add('gamepad-active');
  padPoint = moveCursor(
    padPoint,
    { x: 0, y: 0 },
    0,
    { width: renderer.width, height: renderer.height },
    { padding: 20 },
  );
  if (scope.mode === 'gameplay' && action === 'confirm' && !wasActive) {
    ui.pointer = renderer.screenToWorld(padPoint.x, padPoint.y);
    toast('Controller cursor ready. Press A again to confirm here.');
    return;
  }
  if (action === 'pause') {
    if (scope.key === 'pause') pause(false);
    else if (scope.key === 'battle' || scope.key === 'hud') pause(true);
  } else if (action === 'cancel') controllerBack(scope);
  else if (action === 'focus') {
    if (scope.key === 'battle') {
      padHud = true;
      focusPadControl(document.querySelector('.build-card'));
    } else if (scope.key === 'hud') {
      padHud = false;
      $('battle').focus();
    }
  } else if (['up', 'down', 'left', 'right'].includes(action)) {
    if (scope.mode === 'gameplay') {
      padHud = true;
      focusPadControl(document.querySelector('.build-card'));
    } else controllerNavigate(action, scope);
  } else if (action === 'confirm') {
    if (scope.mode === 'gameplay') {
      ui.pointer = renderer.screenToWorld(padPoint.x, padPoint.y);
      activateBattlePoint(ui.pointer);
      if (ui.selected) {
        updateSelection();
        padHud = true;
        focusPadControl(
          $('upgrade').disabled ? $('closeSelection') : $('upgrade'),
        );
      }
    } else {
      const controls = padControls(scope);
      if (!controls.includes(document.activeElement))
        focusPadControl(controls[0]);
      else {
        const target = document.activeElement;
        if (target.matches('select')) {
          target.selectedIndex =
            (target.selectedIndex + 1) % target.options.length;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else target.click();
        if (
          scope.key === 'hud' &&
          (target.dataset.type || target.id === 'rally') &&
          (ui.build || ui.spell)
        ) {
          padHud = false;
          $('battle').focus();
        }
      }
    }
  } else if (scope.mode === 'gameplay') {
    if (action === 'rally') $('rally').click();
    else if (action === 'home') $('home').click();
    else if (action === 'frontline') $('front').click();
    else if (action === 'previousCard' || action === 'nextCard') {
      const types = Object.keys(BUILDINGS),
        index = types.indexOf(ui.build);
      const next = nextAffordableIndex(
        types.map((type) => BUILDINGS[type]),
        index,
        action === 'nextCard' ? 1 : -1,
        game.state.gold[0],
      );
      if (next < 0) toast('No other buildings are affordable yet.');
      else selectBuild(types[next]);
    }
  } else if (action === 'previousCard' || action === 'nextCard') {
    const controls = padControls(scope),
      i = controls.indexOf(document.activeElement);
    focusPadControl(
      controls[nextFocusIndex(controls, i, action === 'nextCard' ? 1 : -1)],
    );
  }
  if (controllerScope().key !== scope.key) controller.reset();
}
const controller = new GamepadInput({
  onAction: handleControllerAction,
  onConnection: ({ connected }) => {
    if (connected)
      toast('Controller connected. A confirms, B goes back, Start pauses.');
    else {
      padActive = false;
      padHud = false;
      if (canInteract()) {
        pause(true);
        toast('Controller disconnected. Battle paused.');
      }
    }
  },
});
function updateController(now) {
  const scope = controllerScope(),
    frame = controller.update(now, scope);
  $('controllerStatus').textContent = frame.connected
    ? 'Standard controller connected. Input support is experimental; physical device validation is ongoing.'
    : frame.unsupported.length
      ? 'This controller uses a nonstandard mapping. Use keyboard/touch or a standard-mapped controller.'
      : 'No controller connected. Connect a standard controller and press a button. Keyboard and touch always remain available.';
  if (scope.mode === 'gameplay' && frame.connected) {
    if (
      Math.hypot(frame.cursor.x, frame.cursor.y) ||
      Math.hypot(frame.camera.x, frame.camera.y)
    )
      padActive = true;
    padPoint = moveCursor(
      padPoint,
      frame.cursor,
      frame.dt,
      { width: renderer.width, height: renderer.height },
      { speed: 570, precision: frame.precision, padding: 20 },
    );
    if (frame.camera.x) {
      renderer.pan(-frame.camera.x * 850 * frame.dt);
      follow = false;
    }
    if (padActive) ui.pointer = renderer.screenToWorld(padPoint.x, padPoint.y);
  }
  document.body.classList.toggle(
    'gamepad-active',
    padActive && frame.connected,
  );
  const visible =
    padActive && frame.connected && controllerScope().mode === 'gameplay';
  $('controllerCursor').classList.toggle('hidden', !visible);
  if (visible) {
    $('controllerCursor').style.left = padPoint.x + 'px';
    $('controllerCursor').style.top = padPoint.y + 'px';
  }
}
document.addEventListener(
  'pointerdown',
  () => {
    padActive = false;
    document.body.classList.remove('gamepad-active');
    padHud = false;
    controller.reset();
  },
  true,
);
document.addEventListener('keydown', () => {
  padActive = false;
  document.body.classList.remove('gamepad-active');
  padHud = false;
  controller.reset();
});

syncProfileSafety();
