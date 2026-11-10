import {lastEngineView,createLastEngineAudioObserver} from './final-chapter-view.js';
import { createViewportPause, inspectMobileGeometry, visibleViewportRect, insetViewportRect, fitMobileViewport, protectedToastTop } from './mobile-battlefield.js';
import { createProfileSession, PROFILE_MARKER_KEY, CURRENT_PROFILE_PROTOCOL_VERSION } from './profile-session.js';
import { createInputScopeGuard } from './input-scope.js';
import { ACTIONS, effectiveBindings, normalizeKeyboardMap, bindingConflict, bindableCode, keyLabel, actionLabel, ignoreKeyboardEvent, keyboardAction } from './keyboard.js';
import { createMenuHistory, seedMenuAncestors } from './menu-history.js';
import { supportsAutonomousAir } from './autonomous-air.js';
import { supportsCitadelOptions, citadelOptionStatus, CITADEL_AI_TEXT } from './citadel-options.js';
import { skirmishRulesetId, citadelStatusText, fogSetupAllowed, observedEnemyCitadelText } from './citadel-view.js';
import { supportsFog, observe, observeObjectiveResult } from './fog.js';
import { FogRenderer, observationFacade, observationHUD, ObservationAudio } from './fog-view.js';
import { bridgeIncome, bridgeStatus, bridgeSummary, BRIDGE_RULES_TEXT, supportsCampaignControl, campaignControlStatus, CAMPAIGN_CONTROL_RULES_TEXT } from './bridge-control.js';
import { controlProgressLabel, controlProgressDescription, CONTROL_MAP_LEGEND } from './campaign-control-view.js';
import { airRulesGuide, airBuildingDescription } from './flight-orders-view.js';
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
  getRuleset,
  DEFAULT_SKIRMISH_RULESET_ID,
  buildBounds,
  SPELL,
  upgradeCost,
} from './engine.js';
import { Renderer, iconSVG, drawUnitPortrait } from './render.js';
import { renderMissionScouting } from './scouting.js';
import { createBattleJournal, exportBattleReport } from './battle-report.js';
import { renderBattleReport, reportConcealsFinale } from './report-view.js';
import {
  createCodex,
  UNIT_CODEX,
  STRUCTURE_CODEX,
  ECONOMY_GUIDE,
  formatNumber,
  formatSeconds,
} from './codex.js';
import {
  CURRENT_CHALLENGES as CHALLENGES,
  createCurrentChallenge,
  restartChallenge,
  getChallengeForGame,
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
  getBattleWriteFailure,
} from './persistence.js';
import { decodeBattle, encodeBattle, scenarioForBattle, identityOf } from './battle-codec.js';
import { GameAudio } from './audio.js';
import { advanceObjectiveBattle } from './objectives.js';
import { campaignBuildChoices, campaignTeaching, campaignCoach, drawCampaignGuidance, guidancePointVisible } from './campaign-flow.js';
import { missionBriefing, signalProtectionSummary } from './campaign-presentation.js';
import { minorReserveView } from './minor-reserve-view.js';
import { hasChartedIntelligence, chartedObjectiveTargets, chartedObjectiveObservation } from './campaign-intelligence.js';
import { createProtectedObjectiveMonitor, protectedLossDetails, isProtectedCampaignBuilding } from './protected-objectives.js';
import { createObjectiveAlertPolicy } from './objective-alerts.js';
import {
  CURRENT_CAMPAIGN_CHAPTERS as CAMPAIGN_CHAPTERS,
  ONBOARDING_CHAPTER,
  CAMPAIGN_PROGRESS_MISSIONS as CAMPAIGN_MISSIONS,
  isIntroMission,
  createCampaignMission,
  createCampaignRestart,
  createProgressionCampaignMission,
  getCampaignLaunchMission,
  getCampaignMission,
  campaignScenarioForGame,
  getCampaignRoster,
  evaluateCampaignMission,
  getCampaignTargets,
  readCampaignProgress,
  readCampaignProgressState,
  mergeCampaignProgress,
  writeCampaignProgress,
  recordCampaignResult,
  campaignEndingReward,
  getProgressionCampaignOverview as getCampaignOverview,
  isMissionUnlocked,
} from './campaign.js';
const $ = (id) => document.getElementById(id);
const ordinaryRenderer = new Renderer($('battle'), $('minimap'));
let renderer = ordinaryRenderer, fogRenderer = null;
const fogAudio = new ObservationAudio({ ownCommandSounds: false });
const engineAudio = createLastEngineAudioObserver();
let presentation = null, presentationGame = null;
function refreshPresentation() {
  presentationGame = game;
  if (supportsFog(game.ruleset)) {
    const observed = objectiveOutcome ? observeObjectiveResult(game, 0, objectiveOutcome) : observe(game, 0);
    const charted = chartedMission();
    presentation = observationFacade(charted
      ? chartedObjectiveObservation(charted, observed, getCampaignTargets(game, currentCampaign)) : observed);
  } else presentation = game;
  return presentation;
}
function battleView() { return presentationGame === game && presentation ? presentation : refreshPresentation(); }
function battleFront() { const view = battleView(); return view.fog ? view.fog.frontX : view.state.frontline; }
function resetBattlePresentation() {
  renderer.vfx?.reset(); renderer.rootwardenMotion?.clear();
  const zoom = renderer.zoom;
  if (supportsFog(game.ruleset)) fogRenderer ||= new FogRenderer($('battle'), $('minimap'));
  renderer = supportsFog(game.ruleset) ? fogRenderer : ordinaryRenderer;
  renderer.zoom = zoom; renderer.reducedMotion = preferences.reducedMotion;
  renderer.vfx?.setPreferences({ reducedMotion: preferences.reducedMotion, quality: preferences.quality });
  renderer.vfx?.reset(); renderer.rootwardenMotion?.clear();
  renderer.resize(); fogAudio.reset(); engineAudio.prime(game);
  presentation = null; presentationGame = null;
  ui.pointer = null; ui.selected = null;
  refreshPresentation();
}

// Background interruption must survive closing a panel that had paused play.
// Without an interruption, ordinary Help/Options close behavior is unchanged.
function holdInterruptedDialogs() {
  if (!started || game.state.winner !== null || objectiveOutcome) return;
  if (!$('helpModal').classList.contains('hidden')) helpWasPaused = true;
  if (!$('settingsModal').classList.contains('hidden')) {
    settingsWasPaused = true;
    $('settingsDone').textContent = 'Back to pause menu';
  }
}

// Read-only field reference. Text is authored data; escape it before markup.
function populateFieldGuide(context = null) {
  const { UNIT_CODEX, STRUCTURE_CODEX, ECONOMY_GUIDE } = createCodex(context);
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
  const airGuide = airRulesGuide(context);
  $('flightGuide').classList.toggle('hidden', !airGuide);
  $('flightGuideTitle').textContent = airGuide?.title || '';
  $('flightGuideText').textContent = airGuide?.detail || '';
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
        ['Training interval', formatSeconds(u.production.spawnTime)],
      ])}
      <p><b>${esc(u.production.name)}</b> · ${n(u.production.cost)} gold<br>Upgrades: ${u.production.upgradeCosts.map(n).join(' / ')} gold</p>
      <p><b>Use it for:</b> ${esc(u.advantages)}</p>
      <p><b>Watch out for:</b> ${esc(u.cautions)}</p>
      ${list(u.mechanics)}
    </div></details>`,
  ).join('');
  for (const canvas of $('unitCodex').querySelectorAll('[data-portrait]'))
    drawUnitPortrait(canvas, canvas.dataset.portrait, 0, context);
  $('structureCodex').innerHTML = STRUCTURE_CODEX.map(
    (
      b,
    ) => `<details class="codex-card codex-structure" data-codex-structure="${esc(b.id)}">
    <summary><span class="codex-building" aria-hidden="true">${iconSVG(b.id)}</span><span><strong>${esc(b.name)}</strong><small>${esc(b.role)}</small><em>${n(b.cost)} GOLD · ${n(b.hp)} HEALTH</em></span><span class="codex-expand" aria-hidden="true">+</span></summary>
    <div class="codex-body"><p><b>Upgrades:</b> ${b.upgradeCosts.map(n).join(' / ')} gold</p><p><b>Use it for:</b> ${esc(b.advantages)}</p><p><b>Watch out for:</b> ${esc(b.cautions)}</p>${list(b.mechanics)}</div></details>`,
  ).join('');
  $('economyCodex').innerHTML = `${stats([
    [ECONOMY_GUIDE.startingGoldLabel || 'Starting gold', n(ECONOMY_GUIDE.startingGold)],
    ['Base income', `${n(ECONOMY_GUIDE.baseIncome)} /s`],
    ['Citadel health', n(ECONOMY_GUIDE.citadelHp)],
    ['Mine cap', n(ECONOMY_GUIDE.mineCap)],
  ])}
    <h3>Build an economy you can defend</h3>${list(ECONOMY_GUIDE.notes)}<h3>Upgrades</h3>${list(ECONOMY_GUIDE.upgrades)}<h3>Overtime</h3><p>${esc(ECONOMY_GUIDE.overtime.description)}</p>`;
}
populateFieldGuide();

const viewportPause = createViewportPause();
let mobileLayout = 'ordinary';
let protectedMonitor = null;
let protectedAlerts = null;
let protectedAnnouncementUntil = 0;
const protectedControls = new Map();
let armedProtectedControl = null;
let armedReserveControl = null, lastReservePhase = null;
let battleJournal = null, lastBattleReport = null, hasLastResult = false, reportFault = false;
let selectedMap = 'classic';
let selectedRuleset = getRuleset(DEFAULT_SKIRMISH_RULESET_ID).endgame.forcedDecay ? 'frontier-air-local-timed' : 'frontier-air-local-open';
let battleSafetyReason = null, resumeProblem = null;
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
let mode = 'campaign',
  selectedChallenge = CHALLENGES[0].id,
  currentChallenge = null,
  currentCampaign = null,
  objectiveOutcome = null,
  selectedCampaign = CAMPAIGN_MISSIONS[0].id,
  selectedChapter = CAMPAIGN_CHAPTERS[0].id;
let expandedBuilds = false, resumedBattle = false, coachEnabled = true;
let campaignPage = 'mission', briefingMission = null;
// A confirmed restart keeps only a fresh, page-local briefing choice. It is
// neither an active battle nor a saved checkpoint until Begin is activated.
let briefingRestart = null;
// A teaching hold stops simulation, while ordinary battle commands remain available.
// Manual, visibility, viewport and storage pauses keep their existing guards.
let coachingHold = false;
// UI-only first-build gate. Never persisted into a battle or campaign profile.
let firstBuildHold = false;
let navigationAttempt = 0, navigationGame = null;
var menuHistory = null;
let navigationAway = false;
function syncMenuHistory() { if (!navigationAway && !document.hidden) menuHistory?.sync(); }
const labels = {
  barracks: ['Barracks', 'Shielded warriors', '9s / wave'],
  archery: ['Archery', 'Ranged support', '10s / wave'],
  foundry: ['Foundry', 'Structure breaker', '17s / wave'],
  watchtower: ['Watchtower', 'Hold the line', 'Ranged defense'],
  mint: ['Gold mine', 'Grow your economy', '+2.5 gold /s'],
  sanctum: ['Sanctum', 'Magic & splash', '14s / wave'],
  aerie: ['Aerie', 'Flying raiders', '15s / wave'],
  wardenLodge: ['Warden lodge', 'Durable front line', '12s / wave'],
};
const profileSession = createProfileSession(() => localStorage, { requiredProtocolVersion: CURRENT_PROFILE_PROTOCOL_VERSION });
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
const initialOverview = getCampaignOverview(campaignProgress);
const nextCampaign = initialOverview.nextMissionId || ((initialOverview.completed || initialOverview.cleared === initialOverview.total)
  ? initialOverview.missions.at(-1).id : initialOverview.missions[0].id);
if (initialOverview.completed) mode = 'skirmish';
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
  skirmishBridgeIncome: false,
};
let keyboardCapture = null, keyboardLoadWarning = '', keyboardSavePending = false;
try {
  const saved = JSON.parse(preferenceSession.initial().value || '{}');
  if (saved && typeof saved === 'object') {
    for (const key of ['sound', 'music', 'sfx', 'reducedMotion', 'skirmishBridgeIncome'])
      if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
    if (Number.isFinite(saved.volume))
      preferences.volume = Math.max(0, Math.min(1, saved.volume));
    if (['high', 'low'].includes(saved.quality))
      preferences.quality = saved.quality;
    if (Object.hasOwn(saved, 'keyboard')) {
      try { preferences.keyboard = normalizeKeyboardMap(saved.keyboard); }
      catch { keyboardLoadWarning = 'Saved keyboard controls could not be read. Defaults apply on this page; the saved data has not been changed.'; }
    }
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
    ? 'These preferences apply only to this page. Saving could not be confirmed. ' +
      (['changed', 'initial-unavailable', 'blocked'].includes(preferenceSession.reason())
        ? 'The saved profile or preferences cannot be safely replaced by this tab. Export this session before reloading.'
        : 'Keep this page open, restore storage access or space, then retry saving.')
    : '';
}
function retryPreferences(notify = false) {
  const dirty = preferenceSession.dirty(), ok = preferenceSession.retry();
  updatePreferenceSaveStatus();
  if (dirty && ok && keyboardSavePending) {
    keyboardSavePending = false;
    $('keyboardStatus').textContent = 'Keyboard controls saved.';
  }
  if (dirty && ok && keyboardLoadWarning) {
    keyboardLoadWarning = 'Unreadable keyboard controls were replaced with defaults when preferences were saved.';
    $('keyboardStatus').textContent = keyboardLoadWarning;
  }
  if (notify && dirty && ok) toast('Preferences saved.');
  return ok;
}
function savePreferences() {
  preferences.sound = soundOn;
  preferenceSession.stage(preferences);
  const ok = retryPreferences();
  if (!ok) toast('Preferences apply to this page only. Open Options to retry saving.');
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
  const objective = $('objectiveHUD'), toast = $('toast');
  if ($('app').classList.contains('protected-mobile')) {
    const field = $('battle').getBoundingClientRect();
    const obstacles = (protectedMonitor?.read() || []).filter(t => t.status !== 'lost').map(t => {
      const p = renderer.worldToScreen(t.x, t.y);
      return {top:p.y-112*renderer.scale,bottom:p.y+50*renderer.scale};
    });
    toast.style.top = `${protectedToastTop(field.height, toast.offsetHeight, obstacles)}px`;
    return;
  }
  if ($('app').classList.contains('protected-landscape')) {
    const field = $('battle').getBoundingClientRect();
    const mapTop = $('mapControls').getBoundingClientRect().top - field.top;
    // The protected dock sits outside the field. Keep feedback in its free
    // middle band rather than using the dock's offset or covering the minimap.
    const limit = $('app').classList.contains('protected-compact') ? field.height : mapTop;
    const lastTop = Math.max(8, limit - toast.offsetHeight - 8);
    toast.style.top = `${Math.max(8, Math.min(lastTop, (field.height - toast.offsetHeight) / 2))}px`;
    return;
  }
  toast.style.top = objective.classList.contains('hidden') || objective.closest?.('#protectedDock')
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
function populateBuildCards() {
  $('buildCards').textContent = '';
  updateKeyboardHelp();
for (const [type, d] of Object.entries(game.buildings || BUILDINGS)) {
  const label = labels[type] || [
    d.name,
    d.unit ? 'Trains troops automatically' : 'Frontier building',
    '',
  ];
  const btn = document.createElement('button');
  btn.className = 'build-card';
  btn.setAttribute('aria-pressed', 'false');
  btn.dataset.type = type;
  btn.title = `${d.name} · ${d.cost} gold. ${d.description}`;
  const code = effectiveBindings(preferences.keyboard)['build' + (Object.keys(game.buildings || BUILDINGS).indexOf(type) + 1)];
  btn.setAttribute('aria-label', `${d.name}, ${d.cost} gold. ${d.description}${code ? ' Keyboard: ' + keyLabel(code) + '.' : ''}`);
  btn.innerHTML = `${code ? '<span class="hotkey">' + keyLabel(code) + '</span>' : ''}<div class="card-top"><span class="building-symbol">${iconSVG(type)}</span><div><h3>${label[0]}</h3><span class="role">${label[1]}</span></div></div><span class="cost">◆ ${d.cost}<small>${label[2]}</small></span>`;
  btn.addEventListener('click', () => selectBuild(type));
  $('buildCards').append(btn);
}
}
populateBuildCards();
function canInteract() {
  return (
    started &&
    !paused &&
    !document.hidden &&
    !viewportPause.active &&
    $('coachingModal').classList.contains('hidden') &&
    !recoveryHold &&
    !profileGate &&
    !battleSafetyReason &&
    !game.limitReason &&
    game.state.winner === null &&
    !objectiveOutcome
  );
}
function selectBuild(type) {
  if (!canInteract()) return;
  if (firstBuildHold && type !== 'barracks') {
    toast('Build a barracks first to begin.');
    sound('error');
    return;
  }
  if (!Object.hasOwn(game.buildings || BUILDINGS, type)) {
    toast('That building is not available in this battle.');
    return;
  }
  if (!campaignBuildChoices(currentCampaign, { expanded: expandedBuilds, resumed: resumedBattle, buildings: game.buildings || BUILDINGS }).includes(type)) {
    toast('Choose All buildings in the build bar to use this building.');
    return;
  }
  if (game.state.gold[0] < (game.buildings || BUILDINGS)[type].cost) {
    toast(`Need ${(game.buildings || BUILDINGS)[type].cost} gold for ${(game.buildings || BUILDINGS)[type].name}.${coachingHold ? ' Resume battle to earn more gold.' : ''}`);
    sound('error');
    return;
  }
  ui.build = ui.build === type ? null : type;
  ui.spell = false;
  ui.selected = null;
  follow = false;
  updateSelection();
  syncChoice();
  if (coachingHold && coachEnabled && ui.build) {
    const site = campaignCoach(game, currentCampaign, ui)?.site;
    if (site) { renderer.camera = site.x; renderer.clampCamera(); }
  }
  setCompactBuildOpen(false);
  sound('click');
}
function cancel() {
  ui.build = null;
  ui.spell = false;
  ui.selected = null;
  ui.pointer = null;
  updateSelection();
  syncChoice();
  setCompactBuildOpen(false);
}
function syncChoice() {
  updateCampaignDeck();
  document
    .querySelectorAll('.build-card')
    .forEach((b) => {
      const active = b.dataset.type === ui.build;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  $('rally').classList.toggle('active', ui.spell);
  $('rally').setAttribute('aria-pressed', String(ui.spell));
  $('battle').classList.toggle('placing', !!ui.build || ui.spell);
  $('cancelBuild').classList.toggle('hidden', !ui.build && !ui.spell);
  $('buildPrompt').textContent = ui.build
    ? `PLACE ${(game.buildings || BUILDINGS)[ui.build].name.toUpperCase()} · ◆ ${(game.buildings || BUILDINGS)[ui.build].cost}`
    : ui.spell
      ? supportsFog(game.ruleset) ? 'ARROW VOLLEY · AIM WITHIN SIGHT' : 'ARROW VOLLEY · TAP ENEMY TROOPS'
      : 'BUILD YOUR FRONTIER';
  $('buildHelp').textContent = ui.build
    ? airBuildingDescription(game, ui.build)
    : ui.spell
      ? 'Damages enemy troops in a wide area.'
      : $('buildCards').scrollWidth > $('buildCards').clientWidth + 2
        ? 'Scroll for more buildings. Choose one, then tap a green slot.'
        : 'Choose a building, then place it in your territory.';
  updateCompactBuildControl();
}
function updateCampaignDeck() {
  const cooldown = game.state.spellCooldown[0];
  $('rally').disabled = firstBuildHold;
  $('rallyCost').innerHTML = firstBuildHold
    ? 'Build a barracks <em>to unlock</em>'
    : cooldown > 0
      ? `${Math.ceil(cooldown)}s <em>Recharging</em>`
      : `◆ ${SPELL.cost} <em>${SPELL.cooldown}s cooldown</em>`;
  $('rally').style.opacity = firstBuildHold || cooldown > 0 ? '.55' : '1';
  const choices = campaignBuildChoices(currentCampaign, { expanded: expandedBuilds, resumed: resumedBattle, buildings: game.buildings || BUILDINGS });
  const canSimplify = started && !resumedBattle && campaignBuildChoices(currentCampaign, { buildings: game.buildings || BUILDINGS }).length < Object.keys(game.buildings || BUILDINGS).length;
  $('allBuildings').classList.toggle('hidden', !canSimplify);
  $('allBuildings').textContent = expandedBuilds ? 'Fewer buildings' : 'All buildings';
  $('allBuildings').setAttribute('aria-expanded', String(expandedBuilds));
  for (const card of document.querySelectorAll('.build-card'))
    card.classList.toggle('hidden', started && !choices.includes(card.dataset.type));
  $('coachResume').classList.toggle('hidden', !coachingHold || firstBuildHold || !canInteract());
  $('coachReplay').classList.toggle('hidden', coachingHold || !canInteract() || !campaignTeaching(currentCampaign, { autonomousAir: supportsAutonomousAir(game.ruleset) }));
  const hint = started && !objectiveOutcome && game.state.winner === null ? campaignCoach(game, currentCampaign, ui) : null;
  const show = coachEnabled && !!hint && canInteract() && !dialogLayers.some(layer => !layer.classList.contains('hidden'));
  const compact = $('app').classList.contains('protected-compact');
  const open = $('app').classList.contains('compact-build-open');
  $('campaignCoach').classList.toggle('hidden', !show);
  $('toggleCoach').classList.toggle('hidden', !hint);
  $('toggleCoach').textContent = compact ? coachEnabled ? 'Hide' : 'Show' : coachEnabled ? 'Hide hints' : 'Show hints';
  $('toggleCoach').setAttribute('aria-label', coachEnabled ? 'Hide hints' : 'Show hints');
  $('toggleCoach').title = coachEnabled ? 'Hide hints' : 'Show hints';
  $('toggleCoach').setAttribute('aria-pressed', String(coachEnabled));
  const teaching = $('campaignTeaching');
  // Any enabled applicable hint belongs outside the mobile drawer, including
  // a restored tutorial. Latch it so Hide/Show remains reachable. This is only
  // presentation: resumed battles never gain a teaching hold from their hints.
  if (coachingHold || (coachEnabled && hint)) teaching.classList.add('coach-started');
  const available = started && !objectiveOutcome && game.state.winner === null &&
    (coachingHold || (!!hint && teaching.classList.contains('coach-started')));
  const rail = compact && available;
  const collapsed = !coachEnabled;
  const compactActions = rail && collapsed;
  const layoutChanged = $('app').classList.contains('mobile-coaching') !== rail ||
    $('app').classList.contains('coach-collapsed') !== compactActions;
  const focused = document.activeElement;
  const restorePadHud = started && layoutChanged && padHud;
  $('app').classList.toggle('mobile-coaching', rail);
  $('app').classList.toggle('coach-collapsed', compactActions);
  $('app').classList.toggle('coach-held', compactActions && coachingHold && !firstBuildHold);
  const parent = rail ? $('app') : $('commandDeck');
  if (teaching.parentNode !== parent) parent.insertBefore(teaching, rail ? $('commandDeck') : $('deckHeading'));
  // Hide removes the banner itself. Keep only its controls in existing
  // navigation slots, including Start/Resume while a teaching hold is active.
  const actions = $('coachActions');
  const actionParent = collapsed ? compactActions ? $('protectedNavigation') : $('commandDeck') : teaching;
  if (actions.parentNode !== actionParent)
    actionParent.insertBefore(actions, actionParent === $('commandDeck') ? $('deckHeading') : null);
  actions.classList.toggle('hidden', !hint && !coachingHold);
  teaching.classList.toggle('hidden', collapsed || (!rail && !show && !coachingHold && !hint));
  $('coachResume').textContent = compact ? game.state.time === 0 ? 'Start' : 'Resume'
    : game.state.time === 0 ? 'Start battle' : 'Resume battle';
  $('coachResume').setAttribute('aria-label', game.state.time === 0 ? 'Start battle' : 'Resume battle');

  let highlighted = show ? document.querySelector(hint.control) : null;
  let text = hint?.text || '';
  if (firstBuildHold) text += ' Battle starts automatically when you place your barracks.';
  if (show && coachingHold && ui.build && game.state.gold[0] < (game.buildings || BUILDINGS)[ui.build]?.cost)
    text += ' Time and income are stopped during this teaching pause. Resume when you want to earn more gold.';
  if (show && compact && !open && hint.control.startsWith('[data-type=') && !ui.build) {
    highlighted = $('compactBuild');
    text = 'Open Build, then ' + text.charAt(0).toLowerCase() + text.slice(1);
  }
  const point = hint?.site || game.state.buildings.find(b => b.id === hint?.buildingId && b.hp > 0);
  if (show && point && !guidancePointVisible(renderer, game, point) && !open) {
    highlighted = $('minimap');
    text = 'Pan along the road or use the minimap to bring the suggested site into view. ' + text;
  }
  if (!coachControlVisible(highlighted)) highlighted = null;
  for (const element of document.querySelectorAll('.coach-highlight'))
    if (element !== highlighted) element.classList.remove('coach-highlight');
  ui.coachSite = show ? hint.site : null;
  ui.coachBuilding = show ? hint.buildingId : null;
  if (!show) {
    $('coachNext').textContent = '';
    $('coachTitle').textContent = '';
    $('coachText').textContent = '';
  }
  if (show) {
    let next = hint.title;
    if (ui.spell) next = 'Tap enemy troops to fire Arrow volley.';
    else if (ui.build) next = hint.site ? 'Tap any green site; the gold ring is a suggestion.'
      : game.state.gold[0] < (game.buildings || BUILDINGS)[ui.build]?.cost
        ? 'Need more gold. Resume to earn income.' : 'No suggested site. Choose another site or building.';
    else if (hint.buildType) next = `${ui.selected ? 'Close details, then Build → ' : compact && !open ? 'Build → ' : 'Choose '}${(game.buildings || BUILDINGS)[hint.buildType].name}.`;
    else if (hint.control === '#upgrade') next = 'Upgrade the selected building.';
    else if (hint.buildingId) next = 'Tap your marked building to manage it.';
    else if (hint.control === '#front') next = coachingHold ? 'Start when ready, then use Front to follow your army.' : 'Use Front to follow your army.';
    if (show && point && !guidancePointVisible(renderer, game, point) && !open) next = 'Pan or use the minimap to find the marked site.';
    if (coachingHold) next = 'Paused. ' + next;
    if ($('coachNext').textContent !== next || $('coachTitle').textContent !== hint.title || $('coachText').textContent !== text)
      $('campaignCoach').scrollTop = 0;
    $('coachNext').textContent = next;
    if ($('coachTitle').textContent !== hint.title) $('coachTitle').textContent = hint.title;
    if ($('coachText').textContent !== text) $('coachText').textContent = text;
    highlighted?.classList.add('coach-highlight');
  }
  if (layoutChanged) syncProtectedLayout();
  // Moving the same controls must not drop keyboard or controller focus.
  if (focused?.isConnected && actions.contains(focused) && coachControlVisible(focused)) {
    focused.focus({ preventScroll: true });
    if (restorePadHud) padHud = true;
  }
}
$('allBuildings').onclick = () => {
  if (!canInteract()) return;
  const open = $('app').classList.contains('compact-build-open');
  inputScope.interrupt();
  expandedBuilds = !expandedBuilds;
  // Collapsing the roster cancels a selection before it becomes hidden.
  cancel();
  setCompactBuildOpen(open);
  $('allBuildings').focus({ preventScroll: true });
};
$('toggleCoach').onclick = () => {
  if (!canInteract()) return;
  coachEnabled = !coachEnabled;
  if (coachEnabled) $('campaignTeaching').classList.add('coach-started');
  if (!coachEnabled && $('campaignCoach').contains(document.activeElement)) $('toggleCoach').focus({ preventScroll: true });
  updateCampaignDeck();
};
function beginCampaignCoaching({ manual = false } = {}) {
  const lesson = campaignTeaching(currentCampaign, {
    autonomousAir: supportsAutonomousAir(game.ruleset),
    ...(manual ? {} : {
      resumed: resumedBattle,
      completed: !!campaignProgress.missions[currentCampaign]?.completed,
      learnedBasics: !!campaignProgress.missions['roadside-watch']?.completed || !!campaignProgress.missions['first-watch']?.completed,
    }),
  });
  if (!lesson || !started || game.state.winner !== null || objectiveOutcome ||
      (manual && (!canInteract() || viewportPause.active))) return;
  coachingHold = true;
  firstBuildHold = !manual && lesson.startAfterBuild === 'barracks';
  coachEnabled = true;
  inputScope.interrupt();
  resetBattleGesture();
  $('coachingTitle').textContent = lesson.title;
  $('coachingText').textContent = lesson.text;
  $('coachingModal').classList.toggle('hidden', firstBuildHold);
  pauseControl(firstBuildHold && !paused ? 'pause' : 'resume');
  $('battleClockLabel').textContent = 'TEACHING PAUSE';
  if (manual) updateHUD();
  else updateCampaignDeck();
  syncDialogs();
  if (manual) save();
}
function planWithCoaching() {
  inputScope.interrupt();
  $('coachingModal').classList.add('hidden');
  syncDialogs();
  if (!canInteract() || viewportPause.active) return;
  setCompactBuildOpen(false);
  updateHUD();
  const hint = campaignCoach(game, currentCampaign, ui);
  const target = hint && document.querySelector(hint.control);
  if (coachControlVisible(target)) target.focus({ preventScroll: true });
  else if ($('app').classList.contains('protected-compact')) $('compactBuild').focus({ preventScroll: true });
  else $('battle').focus();
}
$('coachingPlan').onclick = planWithCoaching;
$('coachingPlay').onclick = () => pause(false, { explicit: true });
$('coachResume').onclick = () => pause(false, { explicit: true });
$('coachReplay').onclick = () => beginCampaignCoaching({ manual: true });
function toggleBattlePause() {
  pause(coachingHold && !firstBuildHold && !paused ? false : !paused, { explicit: true });
}
function coachControlVisible(element) {
  if (!element || !controlIsVisible(element)) return false;
  const rect = element.getBoundingClientRect();
  const viewport = visibleViewportRect(window.innerWidth, window.innerHeight, window.visualViewport);
  if (rect.width <= 0 || rect.height <= 0 || rect.left < viewport.left || rect.top < viewport.top ||
      rect.right > viewport.right || rect.bottom > viewport.bottom) return false;
  // A layout rectangle alone does not mean a scrolled card is on screen.
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (rect.left < clip.left || rect.right > clip.right)) return false;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (rect.top < clip.top || rect.bottom > clip.bottom)) return false;
  }
  return true;
}
function updateSelection() {
  const b = battleView().state.buildings.find(
    (x) => x.id === ui.selected && x.side === 0,
  );
  $('selectionPanel').classList.toggle('hidden', !b);
  $('selectionPanel').classList.toggle('air-inspector', b?.type === 'aerie');
  $('commandDeck').classList.toggle('inspecting-building', !!b && $('app').classList.contains('protected-mobile'));
  if (!b) return;
  const d = (game.buildings || BUILDINGS)[b.type];
  $('selectionIcon').innerHTML = iconSVG(b.type);
  $('selectionTitle').textContent = d.name;
  $('selectionDetail').textContent =
    `Level ${b.level} · ${d.unit ? (game.units || UNITS)[d.unit].name + ' production' : d.range ? 'Defensive structure' : 'Economy'}`;
  $('selectionStats').innerHTML =
    `<span>♥ ${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}</span><span>${d.unit ? `${(d.spawnTime / (1 + 0.22 * (b.level - 1)) / (game.state.overtime ? 1.65 : 1)).toFixed(1)}s / wave` : d.range ? `Range ${d.range}` : `+${(2.5 * (1 + 0.5 * (b.level - 1))).toFixed(1)} gold /s`}</span>`;
  $('selectionDescription').textContent = airBuildingDescription(game, b.type);
  const cost = game.upgradeCost ? game.upgradeCost(b) : upgradeCost(b);
  $('upgrade').textContent = b.level < 3 ? `Upgrade · ◆ ${cost}` : 'Max level';
  $('upgrade').disabled =
    b.level >= 3 ||
    game.state.gold[0] < cost ||
    paused ||
    game.state.winner !== null;
  $('sell').textContent =
    `Salvage · +${Math.floor((b.invested * 0.5 * b.hp) / b.maxHp)}`;
  const protectedOriginal = isProtectedCampaignBuilding(game, currentCampaign, b.id);
  $('sell').disabled =
    paused || game.state.winner !== null || protectedOriginal;
  if (protectedOriginal) {
    $('sell').textContent = 'Protected objective';
    $('selectionDescription').textContent =
      (currentSignalProtection()?.selectionDescription || 'Keep this building standing.') + ' ' + d.description;
  }
}
$('upgrade').onclick = () => {
  if (!canInteract() || battleSession.status() !== 'current') return;
  const r = game.upgrade(ui.selected);
  if (r.ok) {
    sound('upgrade');
    const b = r.building;
    toast(
      (game.buildings || BUILDINGS)[b.type].unit
        ? 'Upgraded: tougher troops and faster waves.'
        : b.type === 'mint'
          ? 'Upgraded: more gold per second.'
          : 'Upgraded: stronger walls and attacks.',
    );
  } else toast(r.reason);
  refreshPresentation(); updateHUD();
};
$('sell').onclick = () => {
  if (!canInteract() || battleSession.status() !== 'current') return;
  // Resolve the authored originals at action time rather than trusting a
  // disabled button or the previous render frame's protected-target list.
  if (isProtectedCampaignBuilding(game, currentCampaign, ui.selected)) {
    toast('Original mission objectives cannot be salvaged.');
    refreshPresentation(); updateHUD();
    return;
  }
  const r = game.sell(ui.selected);
  if (r.ok) {
    sound('click');
    toast(`Building salvaged for ${r.refund} gold.`);
    cancel();
  } else toast(r.reason);
  refreshPresentation(); updateHUD();
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
  setCompactBuildOpen(false);
};
$('cancelBuild').onclick = cancel;
$('rally').onclick = () => {
  if (!canInteract()) return;
  if (firstBuildHold) {
    toast('Build a barracks first to begin.');
    return;
  }
  if (game.state.spellCooldown[0] > 0) {
    toast(
      `Arrow volley ready in ${Math.ceil(game.state.spellCooldown[0])} seconds.`,
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
  setCompactBuildOpen(false);
  sound('click');
};
function pauseControl(mode = coachingHold && !firstBuildHold ? 'resume' : 'pause') {
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
      ? keyboardTitle('Pause', 'pause')
      : mode === 'resume'
        ? keyboardTitle('Resume', 'pause')
        : 'Return to title';
}
pauseControl();
function pause(value, { explicit = false } = {}) {
  if (!value && document.hidden) return;
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
  if (!value && (battleSafetyReason || game.limitReason)) {
    holdBattleSafety(battleSafetyReason || game.limitReason);
    return;
  }
  if (!value && viewportPause.active) {
    syncViewportSafety();
    if (viewportPause.blocked || !explicit) return;
    viewportPause.clear();
    $('viewportModal').classList.add('hidden');
    interruptMobileInput();
  }
  if (!value && explicit && coachingHold && !firstBuildHold) {
    coachingHold = false;
    $('coachingModal').classList.add('hidden');
    inputScope.interrupt();
    resetBattleGesture();
    setCompactBuildOpen(false);
  }
  if (value) setCompactBuildOpen(false);
  paused = value;
  $('pauseVeil').classList.toggle('hidden', !paused);
  pauseControl(paused || (coachingHold && !firstBuildHold) ? 'resume' : 'pause');
  if (paused) save();
  syncDialogs();
}
$('pause').onclick = toggleBattlePause;
$('resume').onclick = () => pause(false, { explicit: true });
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
    if (viewportPause.active || battleSafetyReason) $('viewportSaveStatus').textContent = 'Saving failed. This battle remains paused on this page. Keep it open and try again.';
    $('pauseSaveStatus').textContent = 'Could not save. This battle stays paused here. Keep this page open, free some storage and try again.';
    $('pauseSaveStatus').classList.add('save-warning');
    toast(
      'Could not save on this browser. Keep this battle open or free some storage, then try again.',
    );
    return;
  }
  showTitle({ focusResume: true });
};
$('viewportExit').onclick = $('saveExit').onclick;
$('viewportResume').onclick = () => pause(false, { explicit: true });
$('speed').onclick = () => {
  speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
  const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
  $('speed').textContent = `${speed}×`;
  $('speed').setAttribute('aria-label', `Battle speed: ${speed}×. Change to ${next}×`);
  $('speed').title = `Battle speed: ${speed}×. Change to ${next}×`;
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
  renderer.camera = battleFront();
  renderer.clampCamera();
  follow = !follow;
  $('front').style.borderColor = follow ? '#f0d18a' : '';
};
function showHelp() {
  helpWasPaused = paused;
  if (started && game.state.winner === null && !objectiveOutcome) pause(true);
  $('helpModal').classList.remove('hidden');
  syncDialogs();
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
    'Three roads, 24 building sites per side. Used by campaign chapters 1–4 and all field trials.',
  'long-march':
    'Three roads with a longer neutral crossing, 24 sites per side. Reinforcements take longer to arrive. Troop and income rules are unchanged.',
  'twin-span':
    'Two roads, 16 building sites per side. Each side has less room to build. Troop and income rules are unchanged.',
};
function renderMapSelection() {
  $('selectedMapName').textContent = getMap(selectedMap).name;
  $('mapDescription').textContent = mapDescriptions[selectedMap];
  for (const button of $('mapChoices').querySelectorAll('[data-map]')) {
    const active = button.dataset.map === selectedMap;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = $('skirmishFog').checked && button.dataset.map !== 'classic';
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
    if ($('skirmishFog').checked && map.id !== 'classic') return;
    selectedMap = map.id;
    renderMapSelection();
    updateSkirmishRules();
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
      .forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
    sound('click');
  };
function holdBattleSafety(reason) {
  if (!reason || !started || game.state.winner !== null || objectiveOutcome) return;
  const first = !battleSafetyReason;
  battleSafetyReason = reason;
  setCompactBuildOpen(false);
  paused = true;
  ui.build = null; ui.spell = false;
  $('battleLimitWarning').textContent = reason;
  $('battleLimitWarning').classList.remove('hidden');
  $('pauseVeil').classList.remove('hidden');
  $('resume').disabled = true;
  $('viewportResume').disabled = true;
  $('viewportTitle').textContent = 'Battle paused safely';
  $('viewportReason').textContent = reason;
  $('viewportModal').classList.remove('hidden');
  pauseControl('resume');
  if (first) { interruptMobileInput(); save(); }
  syncDialogs();
}
function start(
  restored = null,
  restoredChallenge = null,
  restoredCampaign = null,
  { fresh = false, scenarioRevision = null } = {},
) {
  // Reject unsupported setup before any ownership, profile or checkpoint work.
  if (!restored && mode === 'skirmish' && $('skirmishFog').checked &&
      !fogSetupAllowed(selectedMap, selectedRuleset, $('skirmishBridgeIncome').checked)) {
    toast('Fog requires Classic, open endgame and bridge income off. Your selections and saved battle are unchanged.');
    return;
  }
  syncProfileSafety();
  if (recoveryHold || profileGate) {
    showRecoverySettings();
    return;
  }
  if (resumeProblem && !restored) {
    showSettings();
    $('backupStatus').textContent = 'The original saved battle is unchanged. Download it from the title screen, or restore a compatible backup before starting a new battle.';
    return;
  }
  const cid = restored
    ? restoredCampaign
    : mode === 'campaign'
      ? selectedCampaign
      : null;
  const campaignRevision = cid
    ? restored ? campaignScenarioForGame(restored, cid).revision
      : scenarioRevision ?? getCampaignLaunchMission(cid, campaignProgress).scenarioRevision
    : 1;
  if (cid && !isMissionUnlocked(campaignProgress, cid, campaignRevision)) {
    toast('Complete the preceding missions to unlock this one.');
    return;
  }
  // A restart already owns its verified candidate checkpoint. Recheck before
  // replacing the retained game; claiming here could adopt another tab's save.
  if (fresh && battleSession.status() !== 'current') {
    $('restartStatus').textContent = 'The checkpoint changed or storage is unavailable. Your current battle stays paused here. Return to title to continue the newer checkpoint.';
    if (!started) showBriefingWarning('The checkpoint changed or storage is unavailable. Keep this page open, or resume the newer saved battle.');
    return;
  }
  briefingRestart = null;
  $('citadelModal').classList.add('hidden');
  $('briefingRestartStatus').classList.add('hidden');
  $('resultRestartStatus').classList.add('hidden');
  battleSafetyReason = null;
  $('battleLimitWarning').classList.add('hidden');
  $('resume').disabled = false;
  coachingHold = false;
  firstBuildHold = false;
  $('campaignTeaching').classList.remove('coach-started');
  $('coachingModal').classList.add('hidden');
  currentCampaign = cid;
  expandedBuilds = !!campaignProgress.missions[cid]?.completed;
  resumedBattle = !!restored && !fresh;
  coachEnabled = !campaignProgress.missions[cid]?.completed;
  currentChallenge = restored
    ? restoredChallenge
    : mode === 'challenges'
      ? selectedChallenge
      : null;
  game =
    restored ||
    (currentCampaign
      ? ((scenarioRevision === 1 && !getCampaignMission(currentCampaign).rulesetId?.startsWith('frontier-campaign-'))
        ? createCampaignMission(currentCampaign)
        : createProgressionCampaignMission(currentCampaign, campaignProgress))
      : currentChallenge
        ? createCurrentChallenge(currentChallenge)
        : new Game({ difficulty, seed: Date.now() >>> 0, mapId: selectedMap, mapRevision: 1, rulesetId: skirmishRulesetId(selectedRuleset, $('skirmishBridgeIncome').checked, $('skirmishFog').checked), rulesetRevision: 1 }));
  // An ended attempt must not grant terminal sight to its replacement.
  objectiveOutcome = null;
  resetBattlePresentation();
  populateBuildCards();
  populateFieldGuide(game);
  if (!currentChallenge && !currentCampaign) {
    selectedMap = game.map.id;
    renderMapSelection();
    difficulty = game.difficulty;
    document
      .querySelectorAll('[data-difficulty]')
      .forEach((b) => {
        const active = b.dataset.difficulty === difficulty;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
  }
  viewportPause.clear();
  $('viewportModal').classList.add('hidden');
  beginProtectedObjectives();
  beginBattleReport(!!restored && !fresh);
  // Keep the exact verified ownership state on restart. Every later save still
  // checks it, so a write arriving during setup cannot be reclaimed/overwritten.
  if (!fresh) battleSession.claim();
  padHud = false;
  padPoint = { x: renderer.width / 2, y: renderer.height / 2 };
  started = true;
  paused = false;
  speed = 1;
  resultShown = false;
  follow = false;
  heardEffects = new WeakSet(game.state.effects);
  heardProjectiles = new WeakSet(game.state.projectiles);
  renderer.vfx?.reset();
  cancel();
  $('welcome').classList.add('hidden');
  $('restartModal').classList.add('hidden');
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
      : supportsFog(game.ruleset) ? 'SKIRMISH · FOG' : 'SOLO SKIRMISH';
  $('opponentLabel').textContent = mission
    ? mission.name.toUpperCase()
    : currentChallenge
      ? getChallengeForGame(game, currentChallenge).name.toUpperCase()
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
  renderer.resize();
  $('speed').textContent = '1×';
  $('speed').setAttribute('aria-label', 'Battle speed: 1×. Change to 1.5×');
  $('speed').title = 'Battle speed: 1×. Change to 1.5×';
  pauseControl();
  $('pause').onclick = toggleBattlePause;
  renderer.camera = restored && !fresh ? battleFront() : 450;
  renderer.clampCamera();
  initAudio();
  sound('build');
  $('toast').classList.remove('show');
  if (!mission || !coachEnabled || !campaignCoach(game, mission.id, ui)) toast(
    restored && !fresh
      ? 'Battle resumed.'
      : mission
        ? mission.objective
        : currentChallenge
          ? getChallengeForGame(game, currentChallenge).objective
          : 'Choose a building, then tap a green slot to place it.',
  );
  $('battle').focus();
  // Reveal and populate the real HUD before measuring its target controls.
  updateHUD();
  syncViewportSafety();
  if (game.limitReason) holdBattleSafety(game.limitReason);
  beginCampaignCoaching();
  save();
  globalThis.queueMicrotask?.(syncMenuHistory);
}
// Named optional trial positions share the existing stable focus controls and mobile dock.
function riverControlContext() {
  if (currentCampaign !== 'a-river-between-us') return null;
  const target = getCampaignTargets(game, currentCampaign).find(target => target.kind === 'destroy');
  return { name: target.name || 'North Command Post', destroyed: !target.building };
}
function chartedMission() {
  if (!currentCampaign) return null;
  const scenario = campaignScenarioForGame(game, currentCampaign);
  const mission = getCampaignMission(currentCampaign, scenario.revision);
  return hasChartedIntelligence(mission) ? mission : null;
}
function objectiveFocusTargets() {
  const charted = chartedMission();
  if (charted) return chartedObjectiveTargets(charted, battleView(), getCampaignTargets(game, currentCampaign));
  if (['through-the-reed-beds', 'cut-the-bowstrings', 'below-the-ramparts', 'the-last-granary'].includes(currentCampaign)) return getCampaignTargets(game, currentCampaign).map(target => ({
    ...target, label:target.name, road:['North','Middle','South'][target.lane],
    hp:target.building?.hp??0,maxHp:target.building?.maxHp??0,
    percent:target.building?Math.ceil(100*target.building.hp/target.building.maxHp):0,
    status:target.building?'standing':'destroyed',
  }));
  if (protectedMonitor) return protectedMonitor.read();
  if (!currentChallenge) return [];
  return getChallengeTargets(game, currentChallenge).filter(target => target.name).map(target => ({
    ...target, originalId: `${target.type}-${target.x}-${target.lane}`, label: target.name,
    road: ['North', 'Middle', 'South'][target.lane],
    hp: target.building?.hp ?? 0, maxHp: target.building?.maxHp ?? 0,
    percent: target.building ? Math.ceil(100 * target.building.hp / target.building.maxHp) : 0,
    status: target.building ? 'standing' : 'destroyed',
  }));
}
function currentSignalProtection(targets = protectedMonitor?.read() || []) {
  if (!currentCampaign) return null;
  const scenario = campaignScenarioForGame(game, currentCampaign);
  return signalProtectionSummary(getCampaignMission(currentCampaign, scenario.revision), targets, game.state.time);
}
function currentMinorReserve() {
  return currentCampaign === 'wake-the-reserve'
    ? minorReserveView(game, { ended: !!objectiveOutcome }) : null;
}
function beginProtectedObjectives() {
  lastEngineAnnouncementKey = null;
  protectedMonitor = currentCampaign && !chartedMission()
    ? createProtectedObjectiveMonitor(game, currentCampaign) : null;
  protectedControls.clear();
  protectedAnnouncementUntil = 0;
  armedProtectedControl = null;
  armedReserveControl = null;
  lastReservePhase = null;
  $('protectedTargets').textContent = '';
  $('protectedAlert').textContent = '';
  $('resultProtectedLoss').textContent = '';
  $('resultProtectedLoss').classList.add('hidden');
  const targets = objectiveFocusTargets();
  const signals = currentSignalProtection(targets), charted = chartedMission();
  const reserve = currentMinorReserve(), docked = !!targets.length || !!reserve;
  protectedAlerts = protectedMonitor && targets.length
    ? createObjectiveAlertPolicy({battleKey:protectedMonitor,targetIds:targets.map(target=>target.originalId)}) : null;
  protectedAlerts?.observe(targets,{battleKey:protectedMonitor});
  // Reserve real layout space rather than covering the target being focused.
  // Reparent only at battle start, never while a gesture/focus is active.
  if (docked) $('protectedDock').append($('objectiveHUD'));
  else $('battlefield').append($('objectiveHUD'));
  $('protectedDock').classList.toggle('hidden', !docked);
  $('battlefield').classList.toggle('protected-battle', docked);
  $('objectiveHUD').classList.toggle('protect-hud', docked);
  $('app').classList.toggle('minor-reserve-battle', !!reserve);
  $('minorReserveHUD').classList.toggle('hidden', !reserve);
  $('protectedTargets').classList.toggle('hidden', !targets.length);
  $('objectiveIdentity').classList.toggle('hidden', !docked);
  $('objectiveIdentity').textContent = targets.length ? currentChallenge ? `FIELD TRIAL · ANY ${getChallengeForGame(game, currentChallenge).requiredTargets} OF ${targets.length}` : `${game.difficulty.toUpperCase()} · ${currentCampaign === 'cut-the-bowstrings' ? 'BREAK BOTH BOWS' : ['through-the-reed-beds','below-the-ramparts'].includes(currentCampaign) ? 'ANY 2 OF 3' : currentCampaign === 'the-last-granary' ? 'BREAK BOTH MINES' : charted ? (charted.id==='false-quiet'?'FOG · CHARTED FORT':charted.id==='no-fires-tonight'?'FOG · CHARTED POST':'FOG · CHARTED POSTS') : signals ? 'KEEP 1 SIGNAL' : 'PROTECT'}` : '';
  if (reserve) $('objectiveIdentity').textContent = `${game.difficulty.toUpperCase()} · OPTIONAL POST`;
  $('protectedTargets').classList.toggle('trial-targets', (!!currentChallenge || !!charted || ['through-the-reed-beds', 'cut-the-bowstrings', 'below-the-ramparts', 'the-last-granary'].includes(currentCampaign)) && !!targets.length);
  $('protectedTargets').classList.toggle('charted-targets', !!charted && !!targets.length);
  $('protectedTargets').setAttribute('aria-label', charted ? (charted.id==='no-fires-tonight'?'Charted original North Command Post. Health unknown outside current sight; dispatch confirms destruction. Activate to focus its known location.':charted.id==='false-quiet'?'Charted original Middle Road Fort. Health unknown outside current sight; dispatch confirms destruction. Activate the fort to focus its known location.':'Charted original customs posts. Health unknown outside current sight; dispatch confirms destruction. Activate a post to focus its known location.') : currentCampaign === 'cut-the-bowstrings' ? 'Break both original enemy archery ranges; activate a standing position to focus camera' : currentCampaign === 'the-last-granary' ? 'Destroy both original enemy supply mines; activate a standing mine to focus camera' : currentChallenge || ['through-the-reed-beds','below-the-ramparts'].includes(currentCampaign) ? 'Choose any two original enemy positions; activate a standing position to focus camera' : signals ? 'Keep at least one original signal; activate a standing signal to focus camera' : 'Protected original structures; activate to focus camera');
  for (const target of targets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'protected-target';
    button.dataset.protectedId = String(target.originalId);
    button.setAttribute('aria-label', `Focus ${target.label}${target.road ? ', ' + target.road + ' road' : ''}`);
    button.setAttribute('aria-describedby', `protected-health-${target.originalId}`);
    button.title = `Show ${target.label} on the battlefield. Cancels placement.`;
    const name = document.createElement('span');
    name.className = 'protected-name';
    // Keep the authored name readable in the existing compact two-line cards;
    // full road context remains in the accessible label and focus feedback.
    name.textContent = signals || charted ? target.label.split(' · ')[0] : target.label;
    const health = document.createElement('span');
    health.className = 'protected-health';
    health.id = `protected-health-${target.originalId}`;
    const meter = document.createElement('span');
    meter.className = 'protected-meter';
    meter.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    meter.append(fill);
    const hint = document.createElement('span');
    hint.className = 'protected-focus-hint';
    hint.textContent = 'Focus';
    const focusIcon = document.createElement('span');
    focusIcon.className = 'protected-focus-icon';
    hint.append(focusIcon);
    hint.setAttribute('aria-hidden', 'true');
    button.append(name, health, meter, hint);
    button.addEventListener('click', event => {
      // A physical release must belong to a fresh press on this exact control.
      // Keyboard / assistive activation retains native Space/Enter behavior;
      // the global input-scope guard rejects held keys from another scope.
      if (event.detail !== 0 && (armedProtectedControl?.button !== button ||
        (Number.isFinite(event.pointerId) && event.pointerId >= 0 &&
          armedProtectedControl.pointerId !== event.pointerId))) return;
      armedProtectedControl = null;
      focusProtectedObjective(target.originalId);
    });
    protectedControls.set(target.originalId, { button, health, fill, status: null });
    $('protectedTargets').append(button);
  }
  syncProtectedLayout();
}
function syncProtectedLayout() {
  // A reserve card borrows the measured dock footprint, never a required
  // destruction/protection target or a protected-objective control.
  const protect = protectedControls.size > 0 || !!currentMinorReserve();
  const landscape = !!window.matchMedia?.('(max-height: 500px) and (orientation: landscape)').matches;
  const portrait = !!window.matchMedia?.('(max-width: 700px) and (orientation: portrait)').matches;
  const viewport = visibleViewportRect(window.innerWidth, window.innerHeight, window.visualViewport);
  const sidebar = landscape && (viewport.height < 360 || $('app').classList.contains('mobile-coaching'));
  // Apply the mobile shell before reading padding, including desktop-to-phone
  // transitions. Choose the compact tracks from usable space, not notch or
  // home-indicator space that is reserved inside the fitted outer viewport.
  $('app').classList.toggle('protected-landscape', landscape);
  $('app').classList.toggle('protected-portrait', portrait);
  $('app').classList.toggle('protected-mobile', landscape || portrait);
  $('app').classList.toggle('mobile-ordinary', !protect);
  $('app').classList.toggle('protected-compact', landscape || portrait);
  const padding = landscape || portrait ? getComputedStyle($('app')) : {};
  const shortPortrait = portrait && insetViewportRect(viewport, padding).height < 560;
  const next = (sidebar ? 'sidebar' : shortPortrait ? 'portrait-short' : landscape ? 'landscape' : portrait ? 'portrait' : 'ordinary') + ($('app').classList.contains('mobile-coaching') ? ':coaching' : '') +
    ($('app').classList.contains('coach-collapsed') ? ':collapsed' : '');
  const fitted = fitMobileViewport($('app'), viewport, landscape || portrait, padding);
  const changed = mobileLayout !== next;
  const focused = document.activeElement;
  if (changed || fitted) {
    interruptMobileInput();
    setCompactBuildOpen(false);
  }
  mobileLayout = next;
  $('app').classList.toggle('protected-sidebar', sidebar);
  $('app').classList.toggle('protected-short-portrait', shortPortrait);
  $('protectedNavigation').classList.toggle('hidden', !landscape && !portrait);
  const move = (id, parent) => { if ($(id).parentNode !== $(parent)) $(parent).append($(id)); };
  move('objectiveHUD', protect || landscape || portrait ? 'protectedDock' : 'battlefield');
  $('protectedDock').classList.toggle('hidden', !protect && !landscape && !portrait);
  // On mobile every mode uses the same dock and Build control. Ordinary battles
  // show their own objective summary, never invented protected targets.
  $('objectiveHUD').classList.toggle('hidden', !currentCampaign && !currentChallenge && !landscape && !portrait);
  $('objectiveIdentity').classList.toggle('hidden', !protect && !landscape && !portrait);
  if (!protect) $('objectiveIdentity').textContent = landscape || portrait
    ? `${game.difficulty.toUpperCase()} · ${currentCampaign ? 'MISSION' : currentChallenge ? 'FIELD TRIAL' : 'SKIRMISH'}` : '';
  move('battleTop', landscape || portrait ? 'topbar' : 'battlefield');
  move('battleTools', landscape || portrait ? 'protectedNavigation' : 'battlefield');
  move('mapControls', landscape || portrait ? 'protectedNavigation' : 'battlefield');
  const buildParent = portrait || sidebar ? $('protectedNavigation') : $('objectiveHUD');
  const buildNext = portrait || sidebar ? $('battleTools') : $('protectedTargets');
  if ($('compactBuild').parentNode !== buildParent || $('compactBuild').nextSibling !== buildNext)
    buildParent.insertBefore($('compactBuild'), buildNext);
  move('selectionPanel', landscape || portrait ? 'commandDeck' : 'battlefield');
  updateCompactBuildControl();
  if (changed || fitted) {
    renderer.resize();
    syncInputScope();
    if (focused?.isConnected && !focused.closest('.hidden,[inert]') && focused.getClientRects().length) focused.focus({preventScroll:true});
  }
  positionToast();
  return changed || fitted;
}
window.addEventListener('resize', () => { syncProtectedLayout(); syncViewportSafety(); });
function updateCompactBuildControl() {
  const button = $('compactBuild'), open = $('app').classList.contains('compact-build-open');
  const armed = !!(ui.build || ui.spell);
  button.textContent = armed ? 'Cancel' : open ? 'Close' : 'Build';
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', armed ? 'Cancel placement'
    : open ? 'Close building controls' : 'Open building controls');
  button.disabled = !canInteract();
}
function setCompactBuildOpen(open) {
  const next = !!open && $('app').classList.contains('protected-compact');
  const changed = $('app').classList.contains('compact-build-open') !== next;
  const returnFocus = !next && changed && $('app').classList.contains('protected-compact') &&
    $('commandDeck').contains(document.activeElement);
  $('app').classList.toggle('compact-build-open', next);
  if (returnFocus) $('compactBuild').focus({ preventScroll: true });
  updateCompactBuildControl();
  if (changed) {
    syncInputScope();
    if (next && coachEnabled) {
      const hint = campaignCoach(game, currentCampaign, ui);
      const target = hint && document.querySelector(hint.control);
      if (target && $('commandDeck').contains(target)) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateCampaignDeck();
  }
}
$('compactBuild').onclick = () => {
  if (!canInteract()) return;
  if (ui.build || ui.spell) cancel();
  else {
    const open = $('app').classList.contains('compact-build-open');
    if (!open && ui.selected) { ui.selected = null; updateSelection(); }
    setCompactBuildOpen(!open);
  }
};
function canFocusProtectedObjective() {
  return canInteract() && !$('objectiveHUD').closest('[inert]') &&
    !dialogLayers.some(layer => !layer.classList.contains('hidden'));
}
function focusProtectedObjective(originalId) {
  if (!canFocusProtectedObjective()) return;
  protectedMonitor?.observe();
  const target = objectiveFocusTargets().find(item => item.originalId === originalId);
  if (!target || ['lost', 'destroyed'].includes(target.status)) return;
  cancel();
  setCompactBuildOpen(false);
  resetBattleGesture();
  // Cancelling placement can resize the deck; clamp against its final field size.
  renderer.resize();
  renderer.camera = target.x;
  renderer.clampCamera();
  follow = false;
  $('front').style.borderColor = '';
  toast(`Showing ${target.label}.`);
}
document.addEventListener('pointerdown', event => {
  const button = event.target.closest?.('[data-protected-id]');
  armedProtectedControl = button && $('protectedTargets').contains(button) &&
    (event.pointerType !== 'mouse' || event.button === 0) ? { button, pointerId: event.pointerId } : null;
  armedReserveControl = event.target.closest?.('#focusMinorReserve') &&
    (event.pointerType !== 'mouse' || event.button === 0) ? { pointerId: event.pointerId } : null;
}, true);
document.addEventListener('pointercancel', () => { armedProtectedControl = null; armedReserveControl = null; }, true);
window.addEventListener('blur', () => { armedProtectedControl = null; armedReserveControl = null; });
$('focusMinorReserve').onclick = event => {
  if (event.detail !== 0 && (!armedReserveControl ||
    (Number.isFinite(event.pointerId) && event.pointerId >= 0 &&
      armedReserveControl.pointerId !== event.pointerId))) return;
  armedReserveControl = null;
  const reserve = currentMinorReserve();
  if (!reserve || reserve.ended || !canFocusProtectedObjective()) return;
  cancel();
  setCompactBuildOpen(false);
  resetBattleGesture();
  renderer.resize();
  renderer.camera = reserve.focus.x;
  renderer.clampCamera();
  follow = false;
  $('front').style.borderColor = '';
  toast(`Showing ${reserve.focus.label}.`);
};
function updateMinorReserveHUD() {
  const reserve = currentMinorReserve();
  $('minorReserveHUD').classList.toggle('hidden', !reserve || reserve.ended);
  if (!reserve || reserve.ended) return;
  const offscreen = !guidancePointVisible(renderer, game, reserve.focus);
  const active = canFocusProtectedObjective() && !document.hidden;
  $('minorReserveTitle').textContent = reserve.title;
  $('minorReserveDetail').textContent = reserve.detail;
  $('minorReserveLocation').textContent = offscreen ? 'Off-screen · focus north' : 'Focus north';
  $('minorReserveDescription').textContent = reserve.description;
  $('focusMinorReserve').dataset.state = reserve.phase;
  $('focusMinorReserve').disabled = !active;
  $('focusMinorReserve').setAttribute('aria-label', `Focus ${reserve.focus.label}${offscreen ? ', off-screen' : ''}`);
  $('focusMinorReserve').title = reserve.description + ' Focus cancels placement.';
  // Phase changes, not countdown ticks, enter the existing live region. A
  // paused/resumed warning is read with its actual remaining battle time.
  if (active && reserve.phase !== lastReservePhase) {
    if (reserve.phase !== 'armed') $('protectedAlert').textContent = reserve.description;
    lastReservePhase = reserve.phase;
  }
}
function updateProtectedObjectives() {
  const targets = objectiveFocusTargets();
  if (!targets.length) return;
  const signals = currentSignalProtection(targets), charted = chartedMission();
  const enabled = canFocusProtectedObjective();
  const announcements = [];
  for (const target of targets) {
    const control = protectedControls.get(target.originalId);
    if (!control) continue;
    // Keep these exact nodes mounted: damage must not steal focus or change a
    // held touch's target. Announce status transitions, never every HP tick.
    const health = charted ? target.status === 'destroyed' ? 'Cleared'
      : target.status === 'visible' ? `Visible · ${target.percent ?? '?'}% HP`
      : target.status === 'last-seen' ? 'Last seen · HP unknown' : 'Charted · HP unknown'
      : target.status === 'destroyed' ? 'Destroyed'
      : target.status === 'standing' ? `${target.road} · ${target.percent}%`
      : target.status === 'lost' ? signals ? 'Signal lost' : 'Original missing'
      : signals?.lastSignalId === target.originalId ? `${target.percent}% · Last signal`
      : `${target.percent}% HP${target.status === 'critical' ? ' · Critical' : ''}`;
    if (control.health.textContent !== health) control.health.textContent = health;
    control.health.setAttribute('aria-label', charted ? target.statusText : target.status === 'destroyed' ? 'Position destroyed.' : target.status === 'lost' ? 'Original structure missing; health unavailable.'
      : `${Math.ceil(target.hp)} of ${Math.ceil(target.maxHp)} health. ${target.status}.`);
    control.fill.style.width = `${target.percent ?? 0}%`;
    control.fill.parentNode.style.visibility = charted && target.percent === null ? 'hidden' : '';
    control.button.dataset.state = target.status;
    control.button.disabled = !enabled || ['lost', 'destroyed'].includes(target.status);
    if (control.status !== target.status && target.status === 'lost')
      announcements.push(`${target.label}: original structure lost.`);
    if (control.status !== target.status && target.status === 'destroyed')
      announcements.push(charted ? `Dispatch confirms ${target.label} destroyed. Replacements do not restore the original ${charted.id==='false-quiet'?'fort':'post'}.` : `${target.label} destroyed. ${currentCampaign ? evaluateCampaignMission(game, currentCampaign).label : evaluateChallenge(game, currentChallenge).label}`);
    control.status = target.status;
  }
  if (announcements.length) {
    $('protectedAlert').textContent = signals?.permittedLossMessage || announcements.join(' ');
    if (signals?.permittedLossMessage) protectedAnnouncementUntil = performance.now() / 1000 + 2.5;
  }
}
function flushProtectedWarnings(now) {
  if (!protectedAlerts) return;
  protectedAlerts.observe(protectedMonitor.read(),{battleKey:protectedMonitor});
  // Let an allowed sacrifice announcement finish before a queued critical
  // warning replaces it. Observation continues, so lost targets are removed.
  if (now < protectedAnnouncementUntil) return;
  const alert = protectedAlerts.flush({
    battleKey:protectedMonitor,
    active:canFocusProtectedObjective() && !document.hidden,
    ended:!started || game.state.winner !== null || !!objectiveOutcome,
    stale:battleSession.status() === 'stale',
    now,
  });
  if (!alert) return;
  // Reuse the named live status and existing red/HP objective controls. Never
  // steal focus or replace a paid-action toast just to deliver a warning.
  $('protectedAlert').textContent = currentSignalProtection()?.criticalMessage || alert.message;
  if (alert.sound) sound(alert.sound,{volume:.65});
}
function finishProtectedObjectives() {
  const details = protectedLossDetails(protectedMonitor?.observe() || []);
  const list = $('resultProtectedLoss');
  list.textContent = '';
  for (const detail of details) {
    const item = document.createElement('li');
    item.textContent = detail;
    list.append(item);
  }
  list.classList.toggle('hidden', !details.length);
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
    : currentChallenge ? getChallengeForGame(game, currentChallenge) : null;
  try {
    battleJournal = createBattleJournal(game, {
      resumed,
      identity: identityOf(game, scenarioForBattle(currentChallenge, currentCampaign, game)),
      mode: currentCampaign ? 'campaign' : currentChallenge ? 'challenge' : 'skirmish',
      id: currentCampaign || currentChallenge,
      name: `${authored?.name || `${game.map.name} skirmish`}${supportsFog(game.ruleset) ? ' · Fog · post-battle full information' : ''}`,
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
    const concealedFinale = reportConcealsFinale(lastBattleReport);
    const name = (concealedFinale ? 'the-last-fortress' : lastBattleReport.context.id || lastBattleReport.context.mode).replace(/[^a-z0-9-]/gi,'-').slice(0,40);
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
$('start').onclick = () => {
  const restart = selectedBriefingRestart();
  if (!restart) { start(); return; }
  syncProfileSafety();
  if (recoveryHold || profileGate) { showRecoverySettings(); return; }
  if (battleSession.status() !== 'current') {
    updateResume();
    showBriefingWarning('The checkpoint changed or storage is unavailable. Keep this page open, or resume the newer saved battle.');
    return;
  }
  if (!writeBattle(battleSession, SAVE, restart.game, restart.challenge, restart.campaign, { campaignProgress })) {
    showBriefingWarning('The new attempt could not be saved or verified. Keep this page open and try again when storage is available.');
    return;
  }
  start(restart.game, restart.challenge, restart.campaign, { fresh: true });
  if (started) briefingRestart = null;
};
function showBriefingWarning(text) {
  $('briefingRestartStatus').textContent = text;
  $('briefingRestartStatus').classList.remove('hidden');
  $('briefingRestartStatus').scrollIntoView({ block: 'nearest' });
}
function selectedBriefingRestart() {
  return briefingRestart && ((mode === 'campaign' && briefingRestart.campaign === selectedCampaign) ||
    (mode === 'challenges' && briefingRestart.challenge === selectedChallenge)) ? briefingRestart : null;
}
function returnToBriefing(statusId, { replay = false } = {}) {
  syncProfileSafety();
  if (recoveryHold || profileGate) { showRecoverySettings(); return; }
  const warn = text => {
    $(statusId).textContent = text;
    $(statusId).classList.remove('hidden');
    $(statusId).scrollIntoView({ block: 'nearest' });
  };
  if (battleSession.status() !== 'current') {
    warn('The checkpoint changed or storage is unavailable. Keep this page open. Return to title to continue safely.');
    return;
  }
  try {
    // A deliberate replay keeps the previous launch policy: earned opening
    // rosters are available, while historical legacy missions stay legacy.
    // Restart of an unfinished attempt retains its exact admitted identity.
    const legacyReplay = replay && currentCampaign &&
      campaignScenarioForGame(game, currentCampaign).revision === 1 &&
      !getCampaignMission(currentCampaign).rulesetId?.startsWith('frontier-campaign-');
    const candidate = currentCampaign
      ? replay
        ? legacyReplay ? createCampaignMission(currentCampaign) : createProgressionCampaignMission(currentCampaign, campaignProgress)
        : createCampaignRestart(game, currentCampaign)
      : restartChallenge(game, currentChallenge);
    // Retire only our checkpoint, through the existing profile/ownership fence.
    // A failed removal keeps the retained attempt and its dialog on this page.
    if ((progressDirty && !persistProgress()) || !battleSession.remove()) {
      warn('Restart could not be saved or verified. Keep this page open and try again when storage is available.');
      return;
    }
    interruptMobileInput();
    briefingRestart = { game: candidate, campaign: currentCampaign, challenge: currentChallenge };
    if (currentCampaign) {
      mode = 'campaign';
      selectedCampaign = currentCampaign;
      selectedChapter = getCampaignMission(currentCampaign).chapterId;
    } else {
      mode = 'challenges';
      selectedChallenge = currentChallenge;
    }
    saveTimer = 0;
    $('briefingRestartStatus').classList.add('hidden');
    showTitle({ focusStart: true });
  } catch {
    warn('Restart is unavailable. Keep this page open and try again.');
  }
}
function showTitle({ focusStart = false, focusResume = false } = {}) {
  if (recoveryHold || profileGate) {
    showRecoverySettings();
    return;
  }
  viewportPause.clear();
  $('viewportModal').classList.add('hidden');
  padHud = false;
  started = false;
  paused = false;
  coachingHold = false;
  firstBuildHold = false;
  $('coachingModal').classList.add('hidden');
  cancel();
  renderer.vfx?.reset();
  $('resultModal').classList.add('hidden');
  $('restartModal').classList.add('hidden');
  $('citadelModal').classList.add('hidden');
  $('pauseVeil').classList.add('hidden');
  $('welcome').classList.remove('hidden');
  campaignPage = 'mission';
  setMode(mode);
  updateResume();
  syncDialogs();
  if (focusStart || focusResume) requestAnimationFrame(() => {
    if (started || activeDialog !== $('welcome')) return;
    const resume = $('resumeSaved');
    (focusResume && !resume.classList.contains('hidden') ? resume : $('start')).focus();
  });
}
$('playAgain').onclick = () => {
  if ((currentCampaign || currentChallenge) && objectiveOutcome?.failed) {
    returnToBriefing('resultRestartStatus');
    return;
  }
  if (currentCampaign) {
    const overview = getCampaignOverview(campaignProgress);
    if (objectiveOutcome?.completed && currentCampaign === overview.missions.at(-1).id) {
      mode = overview.completed ? 'skirmish' : 'campaign';
      battleSession.remove();
      showTitle({ focusStart: true });
      return;
    }
    mode = 'campaign';
    selectedCampaign = (isIntroMission(currentCampaign) ? overview.legacyIntroduction.nextMissionId : null)
      || overview.nextMissionId || currentCampaign;
    selectedChapter = CAMPAIGN_MISSIONS.find(
      (m) => m.id === selectedCampaign,
    ).chapterId;
  } else if (currentChallenge) mode = 'challenges';
  battleSession.remove();
  showTitle({ focusStart: !!currentCampaign });
};
$('replayMission').onclick = () => {
  if (!currentCampaign || !objectiveOutcome?.completed ||
      (objectiveOutcome.stars >= 3 && currentCampaign !== getCampaignOverview(campaignProgress).missions.at(-1).id)) return;
  returnToBriefing('resultRestartStatus', { replay: true });
};
$('resultMenu').onclick = () => showTitle({ focusStart: true });
$('inspectBattle').onclick = () => {
  $('resultModal').classList.add('hidden');
  toast('Battle ended. Open the field guide or return to title.');
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
    writeBattle(battleSession, SAVE, game, currentChallenge, currentCampaign, { campaignProgress });
  const failure = !ok && getBattleWriteFailure(battleSession);
  if (failure?.code === 'invalid-battle') {
    holdRecovery('This battle could not be saved safely. The previous checkpoint is unchanged. ' + failure.message, 'battle');
    showRecoverySettings();
    return false;
  }
  if (!ok && !saveWarning) {
    toast(
      paused || coachingHold ? 'Saving unavailable. Your battle remains paused on this page; keep it open.' : 'Autosave unavailable. Your battle is still running, but keep this page open.',
    );
    saveWarning = true;
  }
  if (ok) {
    saveWarning = false;
    if (typeof citadelUnsavedGame !== 'undefined' && citadelUnsavedGame === game) {
      citadelUnsavedGame = null;
      updateCitadelSaveWarning();
    }
  }
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
  let valid = null, cid = null, mid = null, error = false, original = null;
  resumeProblem = null;
  try {
    original = storage.get(SAVE);
    if (original) {
      const decoded = decodeBattle(original, { campaignProgress });
      valid = decoded.game; cid = decoded.challengeId; mid = decoded.campaignId;
    }
  } catch (cause) {
    valid = null; error = true;
    resumeProblem = { code: cause.code || 'invalid-battle', message: cause.message };
  }
  $('saveStatus').classList.toggle('hidden', !error);
  $('saveStatus').textContent = error
    ? 'The saved battle could not be loaded and has not been changed. Download the original save, then open Options to restore a compatible backup.' : '';
  $('exportUnreadableBattle').classList.toggle('hidden', !error);
  $('exportUnreadableBattle').onclick = () => {
    if (original !== null) downloadBackup(original, '-original-battle');
  };
  button.classList.toggle('hidden', !valid);
  if (valid) {
    const name = mid
      ? `MISSION · ${CAMPAIGN_MISSIONS.find((m) => m.id === mid).name.toUpperCase()}`
      : cid
        ? `TRIAL · ${CHALLENGES.find((c) => c.id === cid).name.toUpperCase()}`
        : valid.map.id === 'classic' ? 'BATTLE' : valid.map.name.toUpperCase();
    const ruleLabel = !mid && !cid && valid.schemaVersion === 3 ? ` · ${valid.ruleset.endgame.name.toUpperCase()}${valid.state.bridgeControl ? ' · BRIDGES' : ''}${supportsCitadelOptions(valid.ruleset) ? ' · CITADEL CHOICES' : ''}${supportsFog(valid.ruleset) ? ' · FOG' : ''}` : '';
    button.textContent = `RESUME ${name}${ruleLabel} · ${timeText(valid.state.time)}`;
    button.onclick = () => start(valid, cid, mid);
    if (valid.limitReason) button.textContent = `VIEW PAUSED ${name}${ruleLabel} · ${timeText(valid.state.time)}`;
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
      currentChallenge && getChallengeForGame(game, currentChallenge);
  // Use the evaluator's completed result and actual citadel outcome, not the
  // authored victory prose or current bridge ownership. Banked time stays met.
  const victoryText = won && mission?.id === 'a-river-between-us'
    ? game.state.winner === 0 || game.state.bases[1].hp <= 0
      ? 'With the enemy citadel fallen, the River Compact has broken the toll commander’s hold on the river.'
      : 'With the original North Command Post destroyed and 60 seconds of secure passage banked across two crossings, the River Compact can keep its own roads supplied.'
    : won && mission?.id === 'through-the-reed-beds' && (game.state.winner === 0 || game.state.bases[1].hp <= 0)
      ? 'The enemy citadel falls, opening the coastal passage.'
      : mission?.victoryText;
  $('resultEyebrow').textContent = mission
    ? won
      ? 'MISSION WON'
      : 'TRY THE MISSION AGAIN'
    : trial
      ? won
        ? 'FIELD TRIAL COMPLETE'
        : 'TRY THE TRIAL AGAIN'
      : draw
        ? 'NO CITADEL LEFT STANDING'
        : won
          ? 'BATTLE WON'
          : 'TRY ANOTHER STRATEGY';
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
      ? victoryText
      : `${mission.name}: ${objectiveOutcome.label}`
    : trial
      ? `${trial.name}: ${objectiveOutcome.label}`
      : draw
        ? 'Both citadels fell together. Neither commander claims the frontier.'
        : won
          ? 'Your army broke the enemy citadel.'
          : 'Your citadel fell. Try a different army or defend another lane.';
  if (supportsFog(game.ruleset)) $('resultCopy').textContent += ' Fog battle ended. The field and report now reveal full information.';
  finishProtectedObjectives();
  $('resultTime').textContent = timeText(game.state.time);
  $('resultKills').textContent = game.state.stats.kills[0];
  $('resultBuilt').textContent = game.state.stats.built[0];
  finishBattleReport();
  $('resultObjectives').classList.toggle('hidden', !mission && !trial?.requiredTargets);
  $('resultObjectives').textContent = '';
  if (trial?.requiredTargets) {
    for (const target of getChallengeTargets(game, currentChallenge)) {
      const p = document.createElement('p');
      p.textContent = `${target.name}: ${target.building ? won ? 'standing · not needed' : 'standing' : 'destroyed'}`;
      $('resultObjectives').append(p);
    }
  }
  if (['through-the-reed-beds', 'cut-the-bowstrings', 'below-the-ramparts', 'the-last-granary'].includes(mission?.id)) for (const target of getCampaignTargets(game, currentCampaign)) {
    const p=document.createElement('p');
    p.textContent=`${target.name}: ${target.building ? won ? 'standing · not needed' : 'standing' : 'original destroyed'}`;
    $('resultObjectives').append(p);
  }
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
  const finalMission = !!mission && currentCampaign === getCampaignOverview(campaignProgress).missions.at(-1).id;
  $('replayMission').classList.toggle('hidden', !mission || !won || (!finalMission && objectiveOutcome.stars >= 3));
  $('replayMission').textContent = finalMission ? 'Replay mission' : 'Replay for more stars';
  $('resultMenu').textContent = mission ? 'Campaign missions' : 'Return to title';
  $('resultModal').classList.remove('hidden');
  const completion = battleSession.captureResult();
  completion.remove();
  sound(won ? 'win' : 'lose');
  historySession.retain({
    won,
    draw,
    ...(game.schemaVersion === 3
      ? { identity: identityOf(game, scenarioForBattle(currentChallenge, currentCampaign, game)) }
      : { challengeId: currentChallenge, campaignId: currentCampaign, ...(game.map.id !== 'classic' ? { mapId: game.map.id } : {}) }),
    difficulty: game.difficulty,
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
    const priorRoster = getCampaignRoster(campaignProgress);
    const priorProgress = campaignProgress;
    campaignProgress = recordCampaignResult(
      campaignProgress,
      currentCampaign,
      game,
    );
    const ending = campaignEndingReward(priorProgress,campaignProgress,currentCampaign,game);
    if(ending){$('resultEyebrow').textContent='CAMPAIGN COMPLETE';$('resultTitle').textContent=ending.title;$('resultCopy').textContent=ending.text;}
    const earnedRoster = getCampaignRoster(campaignProgress);
    const newBuildings = earnedRoster.buildings.filter(type => !priorRoster.buildings.includes(type));
    if (newBuildings.length) {
      const unlock = document.createElement('p');
      unlock.className = 'campaign-earned';
      unlock.textContent = 'New buildings: ' + newBuildings.map(type => getRuleset(earnedRoster.rulesetId).buildings[type].name).join(', ') + '.';
      $('resultObjectives').append(unlock);
    }
    persistProgress();
    renderCampaign();
  }
  // Match the action's overview after the earned record and persistence merge.
  $('playAgain').innerHTML = mission
    ? (won ? finalMission ? getCampaignOverview(campaignProgress).completed ? 'SKIRMISHES' : 'CAMPAIGN MISSIONS' : 'CONTINUE CAMPAIGN' : 'RETRY MISSION') + ' <span>→</span>'
    : trial
      ? (won ? 'MORE FIELD TRIALS' : 'RETRY FIELD TRIAL') + ' <span>→</span>'
      : 'NEW SKIRMISH <span>→</span>';
  $('progressSaveWarning').classList.toggle('hidden', !progressDirty);
  syncDialogs();
  requestAnimationFrame(keepDialogFocus);
}
let pointer = null;
const activePointers = new Set();
let multiTouch = false;
function cancelBattlePlacement() {
  // A secondary press may arrive while the primary button is still held.
  // Retire that gesture too, so its later release cannot select or buy.
  resetBattleGesture();
  if (canInteract() && (ui.build || ui.spell)) cancel();
}
function localPoint(e) {
  const r = $('battle').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
$('battle').addEventListener('pointerdown', (e) => {
  const panOnly = e.pointerType === 'mouse' && e.button === 1;
  if (e.pointerType === 'mouse' && e.button !== 0 && !panOnly) return;
  if (panOnly) e.preventDefault();
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) {
    multiTouch = true;
    pointer = null;
    ui.dragging = false;
    $('battle').classList.remove('dragging');
    return;
  }
  const p = localPoint(e);
  pointer = { id: e.pointerId, x: p.x, y: p.y, lastX: p.x, moved: false,
    button: e.button, panOnly };
  $('battle').setPointerCapture(e.pointerId);
  ui.pointer = renderer.screenToWorld(p.x, p.y);
  if (panOnly) {
    ui.dragging = true;
    $('battle').classList.add('dragging');
  }
});
// Mouse button chords do not produce another pointerdown. Handle the native
// secondary mousedown as well as contextmenu (including macOS Control-click).
$('battle').addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault(); // No native middle-button autoscroll.
  if (e.button === 2) {
    e.preventDefault();
    cancelBattlePlacement();
  } else if (pointer && e.button !== pointer.button) resetBattleGesture();
});
$('battle').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.pointerType !== 'touch') cancelBattlePlacement();
});
$('battle').addEventListener('auxclick', (e) => {
  if (e.button === 1) e.preventDefault();
});
$('battle').addEventListener('pointermove', (e) => {
  const p = localPoint(e);
  ui.pointer = renderer.screenToWorld(p.x, p.y);
  if (!pointer || pointer.id !== e.pointerId) return;
  if (e.pointerType === 'mouse' && e.buttons !== (pointer.panOnly ? 4 : 1)) {
    resetBattleGesture();
    return;
  }
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
  const moved = pointer.moved, panOnly = pointer.panOnly;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
  if (panOnly || moved || !canInteract()) return;
  // Repeat is an explicit mouse gesture, never a touch/pen or controller modifier.
  activateBattlePoint(w, { repeatBuild: e.pointerType === 'mouse' && e.shiftKey });
});
$('battle').addEventListener('mouseup', (e) => {
  // pointerup only fires after the final button in a chord is released.
  if (pointer?.button === e.button) resetBattleGesture();
});
function activateBattlePoint(w, { repeatBuild = false } = {}) {
  if (!canInteract() || $('app').classList.contains('compact-build-open')) return;
  // Recheck ownership at the command boundary, before spending in a stale tab.
  if (battleSession.status() === 'stale' || dialogLayers.some(layer => !layer.classList.contains('hidden'))) return;
  if (firstBuildHold && ((ui.build && ui.build !== 'barracks') || ui.spell)) {
    toast('Build a barracks first to begin.');
    return;
  }
  if (ui.build) {
    const bounds = buildBounds(game.map, 0);
    if (
      w.x < bounds.minX - 20 ||
      w.x > bounds.maxX + 70 ||
      w.y < bounds.minY - 15 ||
      w.y > bounds.maxY + 20
    ) {
      toast('Build in your territory. Drag back toward your citadel.');
      sound('error');
      return;
    }
    const type = ui.build, goldBefore = game.state.gold[0];
    const snap = renderer.snap(w),
      result = game.build(type, snap.x, snap.y);
    if (result.ok) {
      // Only the successful paid placement from this live command can release
      // the gate. Inspection, cancellation and restored buildings never do.
      if (firstBuildHold && coachingHold && type === 'barracks' &&
          result.building?.side === 0 && result.building.type === type &&
          game.state.gold[0] === goldBefore - (game.buildings || BUILDINGS)[type].cost &&
          canInteract() && battleSession.status() !== 'stale') {
        firstBuildHold = false;
        coachingHold = false;
        interruptMobileInput();
        pauseControl('pause');
      }
      sound('build');
      toast(
        `${(game.buildings || BUILDINGS)[ui.build].name} raised. ${ui.build === 'aerie' && supportsAutonomousAir(game.ruleset) ? 'Gryphons will seek nearby enemies, including one road over.' : (game.buildings || BUILDINGS)[ui.build].unit ? 'First troops in a moment.' : 'Your frontier grows.'}`,
      );
      if (!repeatBuild || game.state.gold[0] < (game.buildings || BUILDINGS)[ui.build].cost) {
        ui.build = null;
        syncChoice();
        setCompactBuildOpen(false);
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
      toast('Arrow volley fired.');
    } else {
      toast(result.reason);
      sound('error');
    }
  } else if (citadelDialogSafe() && renderer.hitCitadel(w, battleView(), 0)) {
    // The home citadel owns its upgrades, just as production buildings own
    // theirs. Placement/spells above and drag/cancel guards stay authoritative.
    showCitadelOptions();
    sound('click');
  } else {
    const b = battleView().state.buildings
      .filter((b) => b.side === 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y),
      )[0];
    ui.selected = b && Math.hypot(b.x - w.x, b.y - w.y) < 95 ? b.id : null;
    requestAnimationFrame(updateSelection);
    if (ui.selected) {
      if ($('app').classList.contains('protected-mobile')) setCompactBuildOpen(true);
      sound('click');
    }
  }
  refreshPresentation();
  if (supportsFog(game.ruleset)) updateHUD();
}
function resetBattleGesture() {
  const captured = pointer?.id;
  activePointers.clear();
  multiTouch = false;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
  if (captured !== undefined && $('battle').hasPointerCapture(captured))
    $('battle').releasePointerCapture(captured);
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
  if (ignoreKeyboardEvent(e)) return;
  if (e.code === 'Escape') {
    if (e.repeat) return;
    e.preventDefault();
    if (!$('restartModal').classList.contains('hidden')) hideRestart();
    else if (!$('backupModal').classList.contains('hidden')) hideBackup();
    else if (!$('settingsModal').classList.contains('hidden')) hideSettings();
    else if (!$('citadelModal').classList.contains('hidden')) hideCitadelOptions();
    else if (!$('helpModal').classList.contains('hidden')) hideHelp();
    else if (!$('resultModal').classList.contains('hidden') && $('resultReport').querySelector('details')?.open) {
      const report = $('resultReport').querySelector('details');
      report.open = false;
      report.querySelector('summary').focus();
    } else if (!$('viewportModal').classList.contains('hidden')) return;
    else if (!$('pauseVeil').classList.contains('hidden')) pause(false, { explicit: true });
    else if (!$('coachingModal').classList.contains('hidden')) planWithCoaching();
    else if (started && game.state.winner === null && !objectiveOutcome && !ui.build && !ui.spell && !ui.selected) pause(true);
    else cancel();
    return;
  }
  if (
    !started ||
    !$('coachingModal').classList.contains('hidden') ||
    !$('citadelModal').classList.contains('hidden') ||
    !$('restartModal').classList.contains('hidden') ||
    !$('backupModal').classList.contains('hidden') ||
    !$('settingsModal').classList.contains('hidden') ||
    !$('helpModal').classList.contains('hidden') ||
    !$('resultModal').classList.contains('hidden') ||
    !$('viewportModal').classList.contains('hidden')
  )
    return;
  // Space/Page/arrow keys scroll the focused lesson; they are not battle commands.
  if ($('campaignCoach').contains(e.target)) return;
  const button = e.target?.closest?.('button');
  // Clicking a battle HUD button leaves native focus there. Keep its ordinary
  // shortcuts usable, but only Resume admits shortcuts in the pause menu.
  // Native activation, text controls, disclosures and higher dialogs retain
  // their guards; pause() still owns all recovery/viewport/profile holds.
  const allowButtonShortcuts = !!button && ((!paused && $('app').contains(button)) ||
    (!$('pauseVeil').classList.contains('hidden') && button === $('resume')));
  const action = keyboardAction(e, preferences.keyboard, { allowButtonShortcuts });
  if (!action) return;
  if (action === 'pause') {
    e.preventDefault();
    toggleBattlePause();
    return;
  }
  if (!canInteract()) return;
  if (action === 'panLeft') {
    e.preventDefault();
    renderer.pan(75);
    follow = false;
  }
  if (action === 'panRight') {
    e.preventDefault();
    renderer.pan(-75);
    follow = false;
  }
  if (action === 'volley' && !$('rally').disabled) { e.preventDefault(); $('rally').click(); }
  if (action.startsWith('build')) {
    const key = Object.keys(game.buildings || BUILDINGS)[Number(action.slice(5)) - 1];
    if (key) { e.preventDefault(); selectBuild(key); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { holdInterruptedDialogs(); audio.setScene('paused'); }
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
  // Retire the removed checkpoint's claim, even if identical bytes were saved
  // again before this event arrived. A different, explicitly claimed checkpoint
  // must survive an older queued removal; equal-byte claims are indistinguishable.
  if (event.newValue === null && event.oldValue !== null) battleSession.release(event.oldValue);
  if (
    started &&
    !battleSession.isCurrent() &&
    game.state.winner === null &&
    !objectiveOutcome
  ) {
    setCompactBuildOpen(false);
    paused = true;
    $('pauseVeil').classList.remove('hidden');
    pauseControl('resume');
    toast(
      'Another tab saved a newer battle. Return to title to resume it; this tab will not overwrite it.',
    );
  }
  if (!started) updateResume();
});
new ResizeObserver(() => { renderer.resize(); positionToast(); syncViewportSafety(); }).observe($('battle'));
new ResizeObserver(positionToast).observe($('objectiveHUD'));
new ResizeObserver(() => syncChoice()).observe($('buildCards'));
let lastEngineAnnouncementKey = null;
let hudTimer = 0,
  lastProfileCheck = 0;
function updateHUD() {
  const view = battleView(), s = view.state;
  updateCitadelUI();
  const bridgeMode = !!s.bridgeControl;
  const controlMode = supportsCampaignControl(game.ruleset);
  const crossing = controlMode ? campaignControlStatus(game) : null;
  $('app').classList.toggle('bridge-income', bridgeMode);
  $('objectiveProgress').removeAttribute('aria-label');
  const bridgeRate = bridgeMode ? bridgeIncome(game)[0] : 0;
  const bridgeLabel = bridgeMode ? `Bridges +${bridgeRate.toFixed(2)} /s` : '';
  $('bridgeBattleStatus').classList.toggle('hidden', !bridgeMode && !controlMode);
  if (bridgeMode || controlMode) {
    const status = (controlMode ? controlProgressDescription(crossing, riverControlContext()) + ' ' : '') + bridgeSummary(game);
    if ($('bridgeBattleStatus').textContent !== status) $('bridgeBattleStatus').textContent = status;
    $('minimap').setAttribute('aria-describedby', 'bridgeBattleStatus');
  } else $('minimap').removeAttribute('aria-describedby');
  $('gold').textContent = Math.floor(s.gold[0]);
  $('income').textContent =
    `+${s.income[0].toFixed(bridgeMode ? 2 : s.income[0] % 1 ? 1 : 0)} /s`;
  $('income').setAttribute('aria-label', bridgeMode
    ? `Total income ${s.income[0].toFixed(2)} gold per second, including ${bridgeRate.toFixed(2)} from bridges.`
    : `Total income ${s.income[0]} gold per second.`);
  const army = s.units.filter((u) => u.side === 0).length;
  $('army').textContent = army >= 70 ? '70/70' : army;
  $('army').title = `${army} / 70 army capacity`;
  $('time').textContent = timeText(s.time);
  $('battleClockLabel').textContent = coachingHold ? 'TEACHING PAUSE' : 'BATTLE TIME';
  for (const [i, prefix] of [
    [0, 'your'],
    [1, 'enemy'],
  ]) {
    const known = Number.isFinite(s.bases[i].hp);
    const hp = known ? Math.ceil((s.bases[i].hp / s.bases[i].maxHp) * 100) : null;
    $(prefix + 'Hp').style.width = known ? hp + '%' : '';
    $(prefix + 'Hp').classList.toggle('hp-unknown', !known);
    $(prefix + 'Hp').setAttribute('aria-hidden', 'true');
    $(prefix + 'HpText').textContent = known ? hp + '%' : '?';
    $(prefix + 'HpText').setAttribute('aria-label', known ? `${prefix === 'your' ? 'Your' : 'Enemy'} citadel health ${hp} percent.` : 'Enemy citadel health unknown.');
  }
  $('phase').innerHTML =
    s.time > 420 && game.ruleset?.endgame?.forcedDecay !== false
      ? 'CITADELS CRUMBLING<small>BREAK THE ENEMY FIRST</small>'
      : s.overtime
        ? 'OVERTIME<small>FASTER WAVES · MORE STRUCTURE DAMAGE</small>'
        : `${game.map.id === 'classic' ? 'THE LONG REACH' : game.map.name.toUpperCase()}<small>${['ZERO', 'ONE', 'TWO', 'THREE'][game.map.lanes.length] || game.map.lanes.length} ${game.map.lanes.length === 1 ? 'LANE' : 'LANES'} · ${game.map.buildLimit} SITES</small>`;
  if (bridgeMode && !$('app').classList.contains('protected-mobile')) {
    const subtitle = document.createElement('small');
    subtitle.textContent = bridgeLabel;
    $('phase').querySelector('small')?.remove();
    $('phase').append(subtitle);
  }
  document
    .querySelectorAll('.build-card')
    .forEach((b) =>
      b.classList.toggle(
        'unaffordable',
        s.gold[0] < (game.buildings || BUILDINGS)[b.dataset.type].cost,
      ),
    );
  $('objectiveHUD').classList.toggle(
    'hidden',
    !currentChallenge && !currentCampaign && !$('app').classList.contains('protected-mobile'),
  );
  if (currentChallenge || currentCampaign) {
    const authored = currentCampaign
        ? CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign)
        : getChallengeForGame(game, currentChallenge),
      outcome =
        objectiveOutcome ||
        (currentCampaign
          ? evaluateCampaignMission(game, currentCampaign)
          : evaluateChallenge(game, currentChallenge));
    const engineView = lastEngineView(game);
    $('phase').textContent = (engineView?.name || authored.name).toUpperCase();
    const label = document.createElement('small');
    label.textContent = currentCampaign ? supportsFog(game.ruleset) ? `CAMPAIGN · FOG${s.overtime ? ' · FASTER WAVES' : ''}` : 'CAMPAIGN' : 'FIELD TRIAL';
    $('phase').append(label);
    $('objectiveProgress').textContent =
      currentCampaign && !outcome.completed && !outcome.failed
        ? outcome.objectives
            .map((o) =>
              o.type === 'last-engine' ? o.text : o.type === 'control'
                ? controlProgressLabel(crossing)
                : o.type === 'destroy-any'
                  ? `${o.value}/${o.target} original positions · need ${o.required}`
                : o.type === 'destroy'
                ? `${o.value}/${o.target} ${chartedMission() ? (currentCampaign==='false-quiet'?'fort confirmed destroyed':'posts confirmed destroyed') : 'targets'}`
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
    if (riverControlContext() && !outcome.completed && !outcome.failed)
      $('objectiveProgress').textContent = controlProgressLabel(crossing, riverControlContext());
    if (controlMode) $('objectiveProgress').setAttribute('aria-label', controlProgressDescription(crossing, riverControlContext()));
    $('objectiveTime').textContent = authored.timeLimit === null ? 'No deadline' :
      `${timeText(Math.ceil(Math.max(0, authored.timeLimit - s.time)))} remaining`;
    if(engineView){
      $('objectiveTime').textContent = engineView.phaseCue + ' · No deadline';
      $('objectiveProgress').textContent = engineView.hudLabel;
      $('objectiveProgress').setAttribute('aria-label',engineView.accessibleLabel);
      if(engineView.announcementKey!==lastEngineAnnouncementKey){$('protectedAlert').textContent=engineView.announcement;lastEngineAnnouncementKey=engineView.announcementKey;}
    }
    const signals = currentSignalProtection();
    if (signals && !outcome.completed && !outcome.failed) {
      $('objectiveProgress').textContent = signals.hudLabel;
      $('objectiveProgress').setAttribute('aria-label', `${signals.hudLabel}. ${signals.evacuationLabel}.`);
      $('objectiveTime').textContent = `${timeText(Math.ceil(Math.max(0, signals.seconds - s.time)))} to evacuate`;
    }
  }
  updateProtectedObjectives();
  updateMinorReserveHUD();
  updateCompactBuildControl();
  if (!currentCampaign && !currentChallenge && $('app').classList.contains('protected-mobile')) {
    $('objectiveProgress').textContent = bridgeMode ? bridgeLabel : 'Destroy the enemy citadel.';
    $('objectiveTime').textContent = bridgeMode
      ? `You ${bridgeStatus(game).filter(b => b.owner === 0).length} · Enemy ${bridgeStatus(game).filter(b => b.owner === 1).length}`
      : `${game.map.lanes.length} ${game.map.lanes.length === 1 ? 'road' : 'roads'}`;
  }
  updateFogMemoryDetails(view);
  if (view.fog) {
    const description = observationHUD(view).description;
    $('battle').setAttribute('aria-description', description);
    $('minimap').setAttribute('aria-label', 'Known terrain minimap. ' + description);
    $('front').title = 'Own front: follows allied ground troops and forward buildings, without scouting.';
    $('front').setAttribute('aria-label', 'Follow your own front. Does not reveal enemies.');
  } else {
    $('battle').removeAttribute('aria-description');
    $('minimap').setAttribute('aria-label', 'Map overview. Tap to move the camera.');
    $('front').title = 'Follow frontline';
    $('front').setAttribute('aria-label', 'Follow the frontline');
  }
  updateSelection();
  updateCampaignDeck();
}
function updateFogMemoryDetails(view) {
  const details = view.fog?.enabled ? observationHUD(view).memoryDetails : [];
  const panel = $('pauseFogDetails'), list = $('pauseFogList'), shown = details.length > 0;
  const hadFocus = panel.contains(document.activeElement);
  panel.classList.toggle('hidden', !shown);
  $('fogMemoryHint').classList.toggle('hidden', !shown);
  $('mapDefaultNote').classList.toggle('hidden', shown);
  if (shown) $('pause').setAttribute('aria-describedby', 'fogMemoryHint');
  else $('pause').removeAttribute('aria-describedby');
  const signature = JSON.stringify(details);
  // Paused memories cannot advance. Keep mounted entries/focus stable across frames.
  if (list.dataset.memories === signature) return;
  list.dataset.memories = signature;
  list.replaceChildren(...details.map(text => {
    const item = document.createElement('li'); item.textContent = text;
    item.setAttribute('tabindex', '0'); return item;
  }));
  $('pauseFogSummary').textContent = `Last-seen details (${details.length})`;
  if (!shown) panel.open = false;
  if (hadFocus) (shown ? $('pauseFogSummary') : paused ? $('resume') : $('pause')).focus();
}
let heardEffects = new WeakSet(),
  heardProjectiles = new WeakSet();
function updateAudio() {
  const ended = game.state.winner !== null || objectiveOutcome;
  audio.setScene(
    document.hidden || paused || coachingHold
      ? 'paused'
      : !started
        ? 'menu'
        : ended
          ? game.state.winner === 0 || objectiveOutcome?.completed
            ? 'victory'
            : 'defeat'
          : 'battle',
  );
  const blocked=!started||paused||coachingHold||document.hidden||!!ended;
  const audioState=audio.getState?.(),audible=!blocked&&(!audioState||audioState.unlocked&&!audioState.muted&&audioState.sfxEnabled&&audioState.volume>0&&audioState.sfxVolume>0);
  const engineCues=engineAudio.update(game,{audible,camera:renderer.camera,width:renderer.width,scale:renderer.scale});
  if (supportsFog(game.ruleset)) {
    const result = fogAudio.update(battleView(), { camera: renderer.camera, width: renderer.width, scale: renderer.scale, paused: !started || paused || coachingHold || document.hidden || !!ended });
    if (started && !paused && !coachingHold && !ended && !document.hidden) {
      audio.setIntensity(result.intensity);
      for (const cue of result.sounds) sound(cue.name, {pan:cue.pan, volume:cue.volume});
    }
    return;
  }
  if(blocked){for(const e of game.state.effects)heardEffects.add(e);for(const p of game.state.projectiles)heardProjectiles.add(p);return;}
  for(const cue of engineCues)sound(cue.name,{pan:cue.pan,volume:cue.volume});
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
    if(engineAudio.isImpact(game,e))continue;
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
  syncViewportSafety();
  if (started && game.limitReason) holdBattleSafety(game.limitReason);
  if (now - lastProfileCheck > 250) {
    syncProfileSafety();
    lastProfileCheck = now;
  }
  updateController(now);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (started && !paused && !coachingHold && game.state.winner === null && !objectiveOutcome) {
    if (currentCampaign || currentChallenge) {
      const authored = currentCampaign
        ? CAMPAIGN_MISSIONS.find((m) => m.id === currentCampaign)
        : getChallengeForGame(game, currentChallenge);
      const outcome = advanceObjectiveBattle(
        game,
        dt * speed,
        (g) => {
          // Observe each actual fixed-step evaluation, including the initial
          // state. This does not change the authored outcome or simulation.
          const snapshot = protectedMonitor?.observe(g);
          if (snapshot) protectedAlerts?.observe(snapshot,{battleKey:protectedMonitor});
          return currentCampaign
            ? evaluateCampaignMission(g, currentCampaign)
            : evaluateChallenge(g, currentChallenge);
        },
        authored.timeLimit ?? Infinity,
      );
      if (outcome.completed || outcome.failed) objectiveOutcome = outcome;
    } else {
      const step = game.update(dt * speed);
      if (step?.code === 'save-safety-limit') holdBattleSafety(step.reason);
    }
    sampleBattleReport();
    saveTimer += dt;
    if (saveTimer > 5) {
      save();
      saveTimer = 0;
    }
    finish();
  }
  refreshPresentation();
  if (follow && started && !paused && !coachingHold && game.state.winner === null && !objectiveOutcome)
    renderer.camera += (battleFront() - renderer.camera) * Math.min(1, dt * 3);
  updateAudio();
  ui.paused =
    paused || coachingHold || !started || game.state.winner !== null || !!objectiveOutcome;
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
  ui.chartedTargets = chartedMission() ? objectiveFocusTargets() : [];
  ui.minorReserve = currentMinorReserve();
  renderer.draw(battleView(), ui, dt);
  if (started && !paused && !objectiveOutcome) drawCampaignGuidance(renderer, game, ui);
  hudTimer += dt;
  if (supportsFog(game.ruleset) || hudTimer > 0.1) {
    updateHUD();
    hudTimer = 0;
  }
  flushProtectedWarnings(now / 1000);
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
  const restart = selectedBriefingRestart();
  const challenge = restart?.challenge ? getChallengeForGame(restart.game, restart.challenge)
    : CHALLENGES.find((c) => c.id === selectedChallenge);
  $('challengeChoices').innerHTML = '';
  for (const [index, c] of CHALLENGES.entries()) {
    const button = document.createElement('button');
    button.className = c.id === selectedChallenge ? 'active' : '';
    button.setAttribute('aria-pressed', String(c.id === selectedChallenge));
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
  $('challengeScouting').innerHTML = renderMissionScouting(challenge);
  $('challengeMedal').textContent = trialRecords[challenge.id]?.completed
    ? `✓ Best ${timeText(trialRecords[challenge.id].bestTime)}`
    : '';
}
function setMode(value) {
  mode = value;
  if (!started) populateFieldGuide(mode === 'skirmish' ? getRuleset(selectedRuleset, 1)
    : mode === 'challenges' ? getRuleset(CHALLENGES.find(c => c.id === selectedChallenge).rulesetId, 1) : null);
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
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
  $('start').classList.remove('hidden');
  $('start').innerHTML =
    mode === 'campaign'
      ? 'BEGIN MISSION <span>→</span>'
      : mode === 'challenges'
        ? 'START FIELD TRIAL <span>→</span>'
        : 'BEGIN SKIRMISH <span>→</span>';
  renderChallenge();
  renderCampaign();
  globalThis.queueMicrotask?.(syncMenuHistory);
}
function updateSkirmishRules() {
  const bridgeMode = $('skirmishBridgeIncome').checked;
  const fog = $('skirmishFog').checked;
  const compatible = fogSetupAllowed(selectedMap, selectedRuleset, bridgeMode);
  $('skirmishFog').disabled = !fog && !compatible;
  $('skirmishRules').disabled = fog;
  $('skirmishBridgeIncome').disabled = fog;
  $('skirmishFogDescription').textContent = 'Requires Classic, open endgame and bridge income off. Known terrain; only current enemy contacts are visible. Last-seen buildings may be stale. Aim Volley within sight. Decorative projectile trails are omitted.';
  renderMapSelection();
  const rules = getRuleset(skirmishRulesetId(selectedRuleset, bridgeMode, fog && compatible), 1);
  $('skirmishRules').value = selectedRuleset;
  $('skirmishRulesDescription').textContent = rules.endgame.forcedDecay
    ? 'Eight buildings, including Rootwardens and gryphons that seek nearby enemies one road over. Production and structure damage increase at 5:00; citadels lose health from 7:00.'
    : 'Eight buildings, including Rootwardens and gryphons that seek nearby enemies one road over. Production and structure damage increase at 5:00; citadels never decay with time.';
  if (!started && mode === 'skirmish') populateFieldGuide(rules);
}
$('skirmishRules').onchange = () => {
  if ($('skirmishFog').checked) { $('skirmishRules').value = selectedRuleset; return; }
  const value = $('skirmishRules').value;
  if (!['frontier-air-local-open', 'frontier-air-local-timed'].includes(value)) return;
  selectedRuleset = value;
  updateSkirmishRules();
};
$('skirmishBridgeIncome').checked = preferences.skirmishBridgeIncome;
$('skirmishBridgeDescription').textContent = BRIDGE_RULES_TEXT;
$('skirmishBridgeIncome').onchange = () => {
  if ($('skirmishFog').checked) { $('skirmishBridgeIncome').checked = preferences.skirmishBridgeIncome; return; }
  preferences.skirmishBridgeIncome = $('skirmishBridgeIncome').checked;
  savePreferences();
  updateSkirmishRules();
};
$('skirmishFog').checked = false;
$('skirmishFog').onchange = () => { updateSkirmishRules(); };
updateSkirmishRules();
for (const button of document.querySelectorAll('[data-mode]'))
  button.onclick = () => {
    setMode(button.dataset.mode);
    sound('click');
  };
function showCampaignPage(page, focusId) {
  campaignPage = page;
  renderCampaign();
  $('campaignConfig').scrollTop = 0;
  if (focusId) $(focusId).focus({ preventScroll: true });
  globalThis.queueMicrotask?.(syncMenuHistory);
}
function selectCampaignMission(id) {
  const mission = CAMPAIGN_MISSIONS.find(m => m.id === id);
  if (!mission) return;
  selectedCampaign = id;
  selectedChapter = mission.chapterId;
  showCampaignPage('mission', 'campaignMissionTitle');
}
function renderCampaign() {
  const overview = getCampaignOverview(campaignProgress),
    legacy = overview.legacyIntroduction,
    showLegacy = legacy.cleared > 0 || isIntroMission(selectedCampaign) || isIntroMission(currentCampaign),
    chapters = [...overview.chapters, ...(showLegacy ? [legacy.chapter] : [])],
    missions = [...overview.missions, ...(showLegacy ? legacy.missions : [])],
    selected = missions.find((m) => m.id === selectedCampaign) || overview.missions[0],
    restart = selectedBriefingRestart(),
    mission = restart?.campaign ? { ...selected,
      ...getCampaignMission(restart.campaign, campaignScenarioForGame(restart.game, restart.campaign).revision),
      // Keep current route copy while the restarted battle keeps its exact rules.
      reward: selected.reward, subtitle: selected.subtitle,
      scenarioRevision: campaignScenarioForGame(restart.game, restart.campaign).revision,
      rulesetId: restart.game.ruleset.id, rulesetRevision: restart.game.ruleset.revision,
      unlocked: isMissionUnlocked(campaignProgress, restart.campaign, campaignScenarioForGame(restart.game, restart.campaign).revision),
    } : selected,
    chapter = chapters.find((c) => c.id === selectedChapter) || chapters.find(c => c.id === mission.chapterId);
  selectedCampaign = mission.id;
  selectedChapter = chapter.id;
  const chapterMissions = missions.filter(m => m.chapterId === chapter.id),
    chapterOverview = chapters.find(c => c.id === chapter.id),
    position = chapterMissions.findIndex(m => m.id === mission.id),
    missionIndex = missions.findIndex(m => m.id === mission.id),
    record = campaignProgress.missions[mission.id];
  for (const page of ['story', 'chapter', 'mission'])
    $(`campaign${page[0].toUpperCase() + page.slice(1)}Page`).classList.toggle('hidden', campaignPage !== page);
  $('campaignStoryNav').toggleAttribute('aria-current', campaignPage === 'story');
  if (campaignPage === 'story') $('campaignStoryNav').setAttribute('aria-current', 'page');
  $('campaignChapterNav').classList.toggle('hidden', campaignPage === 'story');
  $('campaignStoryNav').nextElementSibling.classList.toggle('hidden', campaignPage === 'story');
  $('campaignChapterNav').textContent = chapter.optional || chapter.id === ONBOARDING_CHAPTER.id ? chapter.name : `Chapter ${chapter.number} · ${chapter.name}`;
  $('campaignChapterNav').toggleAttribute('aria-current', campaignPage === 'chapter');
  if (campaignPage === 'chapter') $('campaignChapterNav').setAttribute('aria-current', 'page');
  document.querySelectorAll('[data-mission-path]').forEach(el => el.classList.toggle('hidden', campaignPage !== 'mission'));
  $('campaignMissionPosition').textContent = `Mission ${position + 1} of ${chapterMissions.length}`;
  $('campaignChapterLabel').textContent = chapter.optional ? 'LEGACY LESSONS' : chapter.id === ONBOARDING_CHAPTER.id ? 'START HERE' : `CHAPTER ${chapter.number} · ${chapter.name}`;
  $('campaignChapterProgress').textContent = `${chapterOverview.cleared}/${chapterOverview.total} missions complete · ${chapterOverview.stars}/${chapterOverview.maxStars} stars` + (chapter.plannedMissions && chapterOverview.total < chapter.plannedMissions ? ` · ${chapterOverview.total} available of at least ${chapter.plannedMissions} planned` : '');
  $('campaignMissionStatus').textContent = record?.completed ? `${'★'.repeat(record.stars)}${'☆'.repeat(3 - record.stars)} · Complete` : mission.unlocked ? 'Ready to play' : 'Locked';
  for (const [id, offset] of [['campaignPrevious', -1], ['campaignNext', 1]]) {
    const neighbor = missions[missionIndex + offset];
    $(id).disabled = !neighbor;
    $(id).setAttribute('aria-label', neighbor ? `${offset < 0 ? 'Previous' : 'Next'} mission: ${neighbor.name}` : offset < 0 ? 'No previous mission' : 'No next mission');
    $(id).onclick = () => neighbor && selectCampaignMission(neighbor.id);
  }
  $('campaignReturnMission').textContent = `Return to ${mission.name} →`;
  $('campaignProgressText').textContent =
    `${overview.cleared}/${overview.total} missions · ${overview.stars}/${overview.maxStars} stars`;
  $('campaignCount').textContent = String(overview.total);
  $('campaignChapters').textContent = '';
  $('campaignIntroProgressText').textContent = `Company roster: ${overview.roster.buildings.length}/8 buildings` +
    (overview.returning ? ' · Your earlier campaign progress keeps the full roster available.' : overview.roster.stage < 3 ? ' · Win the next opening mission to add more.' : ' · Full roster unlocked.') +
    (legacy.cleared ? ` Legacy lessons: ${legacy.stars}/${legacy.maxStars} stars retained.` : '');
  $('skipIntroduction').classList.toggle('hidden', !isIntroMission(mission.id));
  for (const c of chapters) {
    const button = document.createElement('button');
    button.dataset.chapter = c.id;
    button.className = c.id === chapter.id ? 'active' : '';
    button.setAttribute('aria-pressed', String(c.id === chapter.id));
    button.innerHTML = `<span>${c.optional ? 'LEGACY LESSONS' : c.id === ONBOARDING_CHAPTER.id ? 'START HERE' : 'CHAPTER ' + c.number} · ${c.stars}/${c.maxStars} ★</span><b>${c.name}</b><small>${c.cleared}/${c.total} missions complete</small>`;
    button.onclick = () => {
      selectedChapter = c.id;
      const candidates = missions.filter((m) => m.chapterId === c.id);
      selectedCampaign = (
        candidates.find((m) => m.unlocked && !m.completed) || candidates[0]
      ).id;
      showCampaignPage('chapter', 'campaignChapterTitle');
    };
    $('campaignChapters').append(button);
  }
  $('campaignChapterTitle').textContent = chapter.subtitle;
  $('campaignChapterStory').textContent = chapters.find(
    (c) => c.id === chapter.id,
  ).completed
    ? chapter.epilogue
    : chapter.description;
  $('campaignMissions').textContent = '';
  for (const m of chapterMissions) {
    const button = document.createElement('button');
    button.dataset.mission = m.id;
    button.className = [
      m.id === mission.id ? 'active' : '',
      !m.unlocked ? 'locked' : '',
      m.completed ? 'complete' : '',
    ].join(' ');
    button.setAttribute('aria-pressed', String(m.id === mission.id));
    button.innerHTML = `<span class="mission-number">${String(m.number).padStart(2, '0')}</span><span><b>${m.name}</b><small>${m.completed ? '★'.repeat(m.record.stars) + '☆'.repeat(3 - m.record.stars) : m.unlocked ? 'READY TO PLAY' : 'LOCKED'}</small></span>`;
    button.onclick = () => {
      selectCampaignMission(m.id);
    };
    $('campaignMissions').append(button);
  }
  $('campaignMissionTitle').textContent = mission.name;
  $('campaignMissionSubtitle').textContent = mission.subtitle;
  $('campaignMissionDescription').textContent = mission.description;
  $('campaignSpeaker').textContent = mission.dialogue.speaker;
  $('campaignDialogue').textContent = mission.dialogue.text;
  const brief = missionBriefing(mission);
  $('campaignGoal').textContent = brief.goal;
  $('campaignGoalFacts').replaceChildren(...brief.facts.map(fact => {
    const li = document.createElement('li');
    li.textContent = fact;
    return li;
  }));
  $('campaignProtection').textContent = brief.protection;
  $('campaignProtection').classList.toggle('hidden', !brief.protection);
  // A newly selected mission always starts with its optional details folded.
  if (briefingMission !== mission.id) {
    for (const id of ['campaignRules', 'campaignScout', 'campaignHintDetails']) $(id).open = false;
    briefingMission = mission.id;
  }
  $('campaignObjective').textContent = mission.objective;
  const roster = getRuleset(mission.rulesetId || 'frontier-legacy', mission.rulesetRevision || 1);
  const rosterLine = 'Available here: ' + Object.values(roster.buildings).map(b => b.name).join(', ') + '.';
  const recordNote = mission.scenarioRevision >= 3 ? ['Campaign records include stars and best times from earlier mission versions.'] : [];
  $('campaignBriefing').innerHTML = [rosterLine, ...mission.briefing, ...recordNote]
    .map((t) => `<li>${t}</li>`)
    .join('');
  $('campaignHint').textContent = mission.hint;
  $('campaignScoutToggle').textContent = `Scout battlefield · ${mission.name}`;
  $('campaignScoutReport').innerHTML = renderMissionScouting(mission);
  $('campaignMedals').textContent =
    'Bonus stars: ' + mission.medals.map((m) => m.label).join(' · ');
  const unlocked = mission.unlocked;
  const needed = mission.chapterId !== ONBOARDING_CHAPTER.id && !isIntroMission(mission.id) && mission.scenarioRevision >= 2 && !overview.returning && !campaignProgress.missions['open-three-roads']
    ? ['open-three-roads'] : mission.prerequisites;
  $('campaignUnlock').textContent = unlocked
    ? mission.reward
    : 'Complete ' +
      needed
        .map((id) => CAMPAIGN_MISSIONS.find((m) => m.id === id).name)
        .join(' and ') +
      ' to unlock.';
  $('campaignUnlock').classList.toggle('locked', !unlocked);
  if (mode === 'campaign') {
    if (!started) populateFieldGuide({ ruleset: roster, map: getMap(mission.mapId, mission.mapRevision ?? 1) });
    $('start').classList.toggle('hidden', campaignPage !== 'mission');
    $('start').disabled = !unlocked;
    $('start').innerHTML =
      (unlocked ? record?.completed ? 'REPLAY MISSION' : 'BEGIN MISSION' : 'MISSION LOCKED') + ' <span>→</span>';
  }
}
$('campaignStoryNav').onclick = () => showCampaignPage('story', 'campaignStoryTitle');
$('campaignChapterNav').onclick = () => showCampaignPage('chapter', 'campaignChapterTitle');
$('campaignReturnMission').onclick = () => showCampaignPage('mission', 'campaignMissionTitle');
$('skipIntroduction').onclick = () => {
  const overview = getCampaignOverview(campaignProgress);
  selectedCampaign = overview.nextMissionId || overview.missions[0].id;
  selectedChapter = CAMPAIGN_MISSIONS.find(mission => mission.id === selectedCampaign).chapterId;
  showCampaignPage('mission', 'campaignMissionTitle');
};
setMode(mode);
// Clicking the home citadel opens its upgrades. The pause menu remains an accessible shortcut.
var citadelNoticeGame = null, citadelNoticePhase = null;
var citadelUnsavedGame = null;
function updateCitadelSaveWarning() {
  const pending = citadelUnsavedGame === game;
  $('citadelSaveWarning').classList.toggle('hidden', !pending);
  $('citadelRetrySave').classList.toggle('hidden', !pending);
  $('citadelSaveWarning').textContent = pending
    ? 'Your choice is paid for and active in this tab, but it is not saved. Keep this page open. Retry saving before leaving or reloading.' : '';
}
function citadelDialogSafe() {
  return started && supportsCitadelOptions(game.ruleset) && !coachingHold && !firstBuildHold && !document.hidden &&
    game.state.winner === null && !objectiveOutcome && !recoveryHold && !profileGate &&
    !viewportPause.active && !battleSafetyReason && !game.limitReason && battleSession.status() === 'current';
}
function updateCitadelUI() {
  const enabled = started && supportsCitadelOptions(game.ruleset) && !coachingHold && !firstBuildHold;
  $('app').classList.toggle('citadel-mode', enabled);
  $('pauseCitadel').classList.toggle('hidden', !enabled);
  $('pauseCitadelLegacy').classList.toggle('hidden', !started || supportsCitadelOptions(game.ruleset));
  $('citadelBattleStatus').classList.toggle('hidden', !enabled);
  updateCitadelSaveWarning();
  if (!enabled) return;
  const own = citadelOptionStatus(game, 0);
  const view = battleView();
  const text = citadelStatusText(game, 0, {paused});
  $('pauseCitadelStatus').textContent = text;
  $('citadelBattleStatus').textContent = `${text} Select your home citadel to view upgrades, or open Citadel upgrades in the pause menu.`;
  $('citadelPlayerStatus').textContent = `${Math.ceil(game.state.bases[0].hp)} / ${game.state.bases[0].maxHp} HP. ${text}`;
  $('citadelEnemyStatus').textContent = view.fog ? observedEnemyCitadelText(view) : `${Math.ceil(game.state.bases[1].hp)} / ${game.state.bases[1].maxHp} HP. ${citadelStatusText(game, 1, {paused})}`;
  $('citadelAIPolicy').textContent = game.ai ? CITADEL_AI_TEXT : 'This battle uses a fixed enemy formation. It does not buy citadel choices or make other new spending decisions. The same 190-gold cost and effects apply to either side; no side receives extra gold.';
  $('citadelReadiness').textContent = own.choice ? `${own.label} chosen. One choice per battle.`
    : !citadelDialogSafe() ? 'Purchasing is unavailable while this battle or its saved checkpoint is interrupted.'
      : own.canBuy ? `Ready. You have ${Math.floor(game.state.gold[0])} gold. Choose one for 190 gold.`
        : `${own.reason} You have ${Math.floor(game.state.gold[0])} gold.`;
  for (const [id, kind, label] of [['buyCitadelArrows','arrows','Extra Arrow'],['buyCitadelRegen','regen','Regeneration']]) {
    const selected = own.choice === kind;
    $(id).disabled = !citadelDialogSafe() || !game.canBuyCitadelOption(kind, 0).ok;
    $(id).textContent = selected ? `${label} chosen` : own.choice ? 'Unavailable · one choice per battle' : `Choose ${label} · 190 gold`;
  }
  const phase = own.choice !== 'regen' ? own.choice : own.blockedByDecay ? 'decay' : own.fullHealth ? 'full' : own.regenWait > 0 ? 'waiting' : 'healing';
  if (citadelNoticeGame !== game) { citadelNoticeGame = game; citadelNoticePhase = phase; }
  else if (!paused && phase !== citadelNoticePhase) {
    if (own.choice === 'regen' && ['healing','waiting','full','decay'].includes(phase))
      toast(phase === 'healing' ? 'Citadel recovering · +3 HP/sec.' : phase === 'waiting' ? 'Regeneration interrupted · wait 8 seconds without damage.' : phase === 'full' ? 'Citadel at full health.' : 'Timed decay has stopped regeneration.');
    citadelNoticePhase = phase;
  }
}
function showCitadelOptions() {
  syncProfileSafety();
  if (!citadelDialogSafe()) return;
  cancel();
  setCompactBuildOpen(false);
  pause(true);
  $('citadelPurchaseStatus').textContent = '';
  $('citadelModal').classList.remove('hidden');
  updateCitadelUI();
  syncDialogs();
}
function hideCitadelOptions() {
  $('citadelModal').classList.add('hidden');
  syncDialogs();
}
function purchaseCitadelOption(kind) {
  syncProfileSafety();
  if (!citadelDialogSafe() || !paused || $('citadelModal').classList.contains('hidden') ||
      dialogLayers.findLast(layer => !layer.classList.contains('hidden')) !== $('citadelModal')) return;
  const result = game.buyCitadelOption(kind, 0);
  if (!result.ok) { $('citadelPurchaseStatus').textContent = result.reason; updateCitadelUI(); return; }
  const message = kind === 'arrows' ? 'Extra Arrow chosen. A second enemy in range receives the extra shot.' : 'Regeneration chosen. Recovery can begin after 8 seconds without damage and never exceeds full health.';
  $('citadelPurchaseStatus').textContent = message;
  sound('upgrade');
  refreshPresentation();
  citadelUnsavedGame = game;
  const persisted = save();
  updateCitadelUI();
  (persisted ? $('citadelResume') : $('citadelSaveWarning')).focus();
}
$('citadelRetrySave').onclick = () => {
  syncProfileSafety();
  if (citadelUnsavedGame !== game || !citadelDialogSafe() || !paused ||
      $('citadelModal').classList.contains('hidden') ||
      dialogLayers.findLast(layer => !layer.classList.contains('hidden')) !== $('citadelModal')) return;
  if (save()) {
    $('citadelPurchaseStatus').textContent = 'Your chosen citadel option is saved.';
    $('citadelResume').focus();
  } else $('citadelSaveWarning').focus();
  updateCitadelSaveWarning();
};
$('pauseCitadel').onclick = showCitadelOptions;
$('citadelBack').onclick = hideCitadelOptions;
$('citadelResume').onclick = () => { hideCitadelOptions(); pause(false, {explicit:true}); };
$('buyCitadelArrows').onclick = () => purchaseCitadelOption('arrows');
$('buyCitadelRegen').onclick = () => purchaseCitadelOption('regen');

// The pause menu is a top-level dialog, independent of battlefield sizing.
function syncPauseMenu() {
  const mission = currentCampaign && CAMPAIGN_MISSIONS.find(m => m.id === currentCampaign);
  const trial = currentChallenge && getChallengeForGame(game, currentChallenge);
  const noun = mission ? 'mission' : trial ? 'field trial' : 'battle';
  const engineView = lastEngineView(game);
  $('pauseBattleName').textContent = engineView?.name || mission?.name || trial?.name || game.map.name;
  $('pauseContext').textContent = `${mission ? 'Campaign' : trial ? 'Field trial' : supportsFog(game.ruleset) ? 'Skirmish · Fog' : 'Skirmish'} · ${timeText(game.state.time)} · ${speed}× speed`;
  updateCitadelUI();
  $('pauseObjective').textContent = engineView?.description || mission?.objective || trial?.objective || 'Destroy the enemy citadel.';
  const controlMode = supportsCampaignControl(game.ruleset);
  $('pauseBridgeDetails').classList.toggle('hidden', !game.state.bridgeControl && !controlMode);
  if (game.state.bridgeControl || controlMode) {
    $('pauseBridgeTitle').textContent = controlMode ? 'Supply crossings' : 'Bridge control · experimental';
    $('pauseBridgeStatus').textContent = (controlMode ? controlProgressDescription(campaignControlStatus(game), riverControlContext()) + ' ' : '') + bridgeSummary(game);
    $('pauseBridgeRules').textContent = riverControlContext()
      ? mission.objective + ' Ground troops capture after two continuous uncontested seconds. Opposing troops, including flyers, interrupt capture and deny control time. Flyers cannot capture. Empty bridges retain ownership. Either side can capture. Falling below two clear bridges pauses your total without resetting it. Once 60 seconds are secured, that goal stays complete while fighting and bridge ownership continue. Replacements do not undo destruction of the original post. Bridges grant no income or capture bounty.'
      : controlMode ? (game.ruleset.id === 'frontier-campaign-leave-roads' ? 'Secure all three bridges for 30 cumulative seconds, or destroy the enemy citadel, by 10:00 while yours survives. Ground captures take two uncontested seconds. Enemy presence pauses earned control time without resetting it. Flyers deny but cannot capture. Empty ownership persists. No bridge income or capture bounty. Normal paid adaptive enemy and 5:00 escalation continue.' : currentCampaign === 'carry-the-crossing' ? 'Hold both clear Twin Span crossings for 60 cumulative seconds, or destroy the enemy citadel, by 10:00. Ground captures take two uncontested seconds. Flyers deny but cannot capture. Contested progress pauses without resetting. No bridge gold. Your citadel must survive; 1 HP is enough.' : CAMPAIGN_CONTROL_RULES_TEXT) : BRIDGE_RULES_TEXT;
    $('pauseBridgeLegend').textContent = controlMode ? (currentCampaign==='carry-the-crossing'?CONTROL_MAP_LEGEND.replace('north, middle, south','north, south'):CONTROL_MAP_LEGEND) : 'Map labels: Y = you, E = enemy, — = unowned, X = payout blocked. An arrow points to the side attempting a ground capture. Bridges are numbered from the top road.';
  }
  $('restartBattle').textContent = `Restart ${noun}…`;
  $('restartTitle').textContent = `Restart ${noun}?`;
  $('confirmRestart').textContent = `Restart ${noun}`;
  $('restartDescription').textContent = (mission || trial
    ? 'This ends your unfinished attempt and returns to its briefing. Begin when you are ready. '
    : 'This replaces your unfinished battle and its checkpoint. ') +
    'Campaign progress, medals, preferences and completed battle history are kept.';
  const status = battleSession.status();
  const unsafe = !!(battleSafetyReason || game.limitReason || viewportPause.active);
  $('restartBattle').disabled = status !== 'current' || unsafe || !!(recoveryHold || profileGate);
  const text = status === 'stale'
    ? 'A newer battle is saved in another tab. Return to title to resume it.'
    : status !== 'current' || saveWarning
      ? 'Saving unavailable. Keep this page open. Your battle remains here until it can be saved.'
      : 'Checkpoint saved on this device. You can return to this battle from the title screen.';
  // Avoid repeatedly announcing an unchanged status when other dialogs change.
  if ($('pauseSaveStatus').textContent !== text) $('pauseSaveStatus').textContent = text;
  $('pauseSaveStatus').classList.toggle('save-warning', status !== 'current' || saveWarning);
}
function hideRestart() {
  $('restartModal').classList.add('hidden');
  syncDialogs();
}
$('restartBattle').onclick = () => {
  syncProfileSafety();
  if (recoveryHold || profileGate) { showRecoverySettings(); return; }
  if (!started || !paused || game.state.winner !== null || objectiveOutcome ||
      battleSafetyReason || game.limitReason || viewportPause.active || battleSession.status() !== 'current') return;
  $('restartStatus').textContent = '';
  $('restartModal').classList.remove('hidden');
  syncDialogs();
};
$('cancelRestart').onclick = hideRestart;
$('confirmRestart').onclick = () => {
  syncProfileSafety();
  if (recoveryHold || profileGate) { hideRestart(); showRecoverySettings(); return; }
  if (!started || !paused || game.state.winner !== null || objectiveOutcome ||
      battleSafetyReason || game.limitReason || viewportPause.active) return;
  if (currentCampaign || currentChallenge) { returnToBriefing('restartStatus'); return; }
  if (battleSession.status() !== 'current') {
    $('restartStatus').textContent = 'The checkpoint changed or storage is unavailable. Keep this battle open. Return to the pause menu to continue safely.';
    return;
  }
  try {
    const candidate = currentCampaign ? createCampaignRestart(game, currentCampaign)
      : currentChallenge ? restartChallenge(game, currentChallenge)
        : new Game({ difficulty: game.difficulty, ai: game.ai, seed: Date.now() >>> 0,
          mapId: game.map.id, mapRevision: game.map.revision,
          ...(game.schemaVersion === 3 ? {rulesetId: game.ruleset.id, rulesetRevision: game.ruleset.revision} : {}) });
    // Use the existing profile/ownership boundary. Never discard the retained
    // battle until a fresh attempt has a verified checkpoint. No progress reward
    // or completed-history row is produced by abandoning an unfinished battle.
    if ((progressDirty && !persistProgress()) ||
        !writeBattle(battleSession, SAVE, candidate, currentChallenge, currentCampaign, { campaignProgress })) {
      $('restartStatus').textContent = 'Restart could not be saved or verified. Your current battle stays paused on this page. Keep it open and try again when storage is available.';
      return;
    }
    start(candidate, currentChallenge, currentCampaign, { fresh: true });
  } catch {
    $('restartStatus').textContent = 'Restart is unavailable. Your current battle stays paused on this page.';
  }
};
function keyboardTitle(label, action) {
  const code = effectiveBindings(preferences.keyboard)[action];
  return label + (code ? ' (' + keyLabel(code) + ')' : '');
}
function updateKeyboardHelp() {
  const map = effectiveBindings(preferences.keyboard), buildings = game.buildings || BUILDINGS;
  $('buildingKeyHelp').textContent = Object.values(buildings).map((building, index) =>
    `${building.name}: ${keyLabel(map['build' + (index + 1)])}`).join(' · ');
  $('battleKeyHelp').textContent = `Volley: ${keyLabel(map.volley)} · Pause / resume: ${keyLabel(map.pause)} · Pan left: ${keyLabel(map.panLeft)} · Pan right: ${keyLabel(map.panRight)} · Esc cancel / menu. Remap in Options. Optional guided practice retains defaults.`;
  $('battle').setAttribute('aria-label', 'Battlefield. Choose a building, then a green build slot to place it once. Hold Shift with a mouse click to keep building. Drag or middle mouse drag to explore. Right-click or Escape cancels placement. ' +
    `Pan left: ${keyLabel(map.panLeft)}. Pan right: ${keyLabel(map.panRight)}. Battle keyboard controls are in Options.`);
  $('rally').title = keyboardTitle('Arrow volley', 'volley');
}
function syncKeyboardSettings() {
  const map = effectiveBindings(preferences.keyboard), buildings = started ? game.buildings : {};
  // Keep the same native buttons and focus throughout capture and save updates.
  if (!$('keyboardRows').children.length) for (const action of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keyboard-row'; row.dataset.keyboardAction = action;
    const label = document.createElement('span'); label.className = 'keyboard-label';
    const key = document.createElement('span'); key.className = 'keyboard-key';
    const change = document.createElement('button'); change.type = 'button'; change.dataset.keyboardChange = ''; change.textContent = 'Change';
    change.onclick = () => {
      cancelKeyboardCapture();
      change.focus();
      keyboardCapture = { action, button: change };
      $('keyboardStatus').textContent = `Press a key for ${actionLabel(action, started ? game.buildings : {})}. Esc cancels; Tab leaves capture.`;
      inputScope.interruptKeys();
    };
    const clear = document.createElement('button'); clear.type = 'button'; clear.dataset.keyboardClear = ''; clear.textContent = 'Clear';
    clear.onclick = () => { cancelKeyboardCapture(); setKeyboardBinding(action, null); };
    row.append(label, key, change, clear); $('keyboardRows').append(row);
  }
  for (const row of $('keyboardRows').children) {
    const action = row.dataset.keyboardAction, label = actionLabel(action, buildings);
    row.querySelector('.keyboard-label').textContent = label;
    row.querySelector('.keyboard-key').textContent = keyLabel(map[action]);
    row.querySelector('[data-keyboard-change]').setAttribute('aria-label', `Change ${label}`);
    row.querySelector('[data-keyboard-clear]').setAttribute('aria-label', `Clear ${label}`);
  }
  if (keyboardLoadWarning) $('keyboardStatus').textContent = keyboardLoadWarning;
}
function cancelKeyboardCapture(message = 'Keyboard capture cancelled.') {
  if (!keyboardCapture) return;
  keyboardCapture = null;
  $('keyboardStatus').textContent = message;
  inputScope.interruptKeys();
}
function setKeyboardBinding(action, code) {
  const next = { version: 1, bindings: { ...preferences.keyboard?.bindings, [action]: code } };
  const conflict = bindingConflict(effectiveBindings(next));
  if (conflict) {
    const other = conflict.actions.find(id => id !== action);
    $('keyboardStatus').textContent = `${keyLabel(code)} is already used by ${actionLabel(other, started ? game.buildings : {})}. Clear or change that binding first.`;
    return false;
  }
  preferences.keyboard = normalizeKeyboardMap(next); keyboardLoadWarning = '';
  const ok = savePreferences();
  keyboardSavePending = !ok;
  syncKeyboardSettings(); populateBuildCards(); pauseControl(); updateCampaignDeck(); updateHUD();
  $('keyboardStatus').textContent = `${actionLabel(action, started ? game.buildings : {})}: ${keyLabel(code)}. ${ok ? 'Saved.' : 'Applies to this page only. Use Retry saving preferences.'}`;
  return true;
}
function captureKeyboardInput(event) {
  if (!keyboardCapture) return;
  if (event.code === 'Tab') { cancelKeyboardCapture(); return; }
  if (ignoreKeyboardEvent(event)) return;
  if (event.repeat) return;
  if (event.code === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); cancelKeyboardCapture(); return;
  }
  if (!bindableCode(event.code)) {
    // Browser/system keys retain their native behavior. Enter must not activate
    // the still-focused Change button a second time while it is listening.
    if (event.code === 'Enter' || event.code === 'NumpadEnter') { event.preventDefault(); event.stopImmediatePropagation(); inputScope.interruptKeys(); }
    $('keyboardStatus').textContent = 'That key is reserved. Use a letter, digit, numpad digit, arrow or Space; Esc cancels.';
    return;
  }
  event.preventDefault(); event.stopImmediatePropagation();
  inputScope.interruptKeys(); // Retire the release even when a conflict keeps capture open.
  const action = keyboardCapture.action;
  if (setKeyboardBinding(action, event.code)) cancelKeyboardCapture($('keyboardStatus').textContent);
}
$('keyboardDefaults').onclick = () => {
  cancelKeyboardCapture();
  delete preferences.keyboard; keyboardLoadWarning = '';
  const ok = savePreferences();
  keyboardSavePending = !ok;
  syncKeyboardSettings(); populateBuildCards(); pauseControl(); updateCampaignDeck(); updateHUD();
  $('keyboardStatus').textContent = 'Keyboard defaults restored. ' + (ok ? 'Saved.' : 'Applies to this page only. Use Retry saving preferences.');
};
$('keyboardSettings').addEventListener('toggle', () => { if (!$('keyboardSettings').open) cancelKeyboardCapture(); });
document.addEventListener('focusin', (event) => { if (keyboardCapture && event.target !== keyboardCapture.button) cancelKeyboardCapture(); });
let settingsWasPaused = false;
function showSettings(event) {
  // Touch may not focus its button. Capture the actual opener before pause()
  // focuses Resume, and retain it through the intermediate pause dialog.
  const opener = event?.currentTarget || document.activeElement;
  settingsWasPaused = paused;
  if (started && game.state.winner === null && !objectiveOutcome) pause(true);
  $('settingsContext').textContent = started && !objectiveOutcome && game.state.winner === null
    ? 'Battle paused. Changes apply immediately.' : 'Changes apply immediately.';
  $('settingsDone').textContent = started && !objectiveOutcome && game.state.winner === null
    ? settingsWasPaused ? 'Back to pause menu' : coachingHold ? 'Back to planning' : 'Resume battle' : 'Done';
  syncSettings();
  $('settingsModal').classList.remove('hidden');
  syncDialogs();
  if (opener) dialogFocus.set($('settingsModal'), opener);
}
function hideSettings() {
  cancelKeyboardCapture();
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
  syncKeyboardSettings();
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
    p.textContent = history.ok ? 'Completed battles appear here.' : 'No previously verified history is available in this tab.';
    $('battleHistory').append(p);
  }
  if (!history.ok && rows.length) {
    const notice = document.createElement('p');
    notice.textContent = 'Showing this tab’s retained results; stored history could not be checked.';
    $('battleHistory').append(notice);
  }
  for (const storedRow of rows) {
    const row = storedRow.identity ? { ...storedRow,
      campaignId: storedRow.identity.scenario.kind === 'campaign' ? storedRow.identity.scenario.id : null,
      challengeId: storedRow.identity.scenario.kind === 'trial' ? storedRow.identity.scenario.id : null,
      mapId: storedRow.identity.map.id } : storedRow;
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
    p.textContent = `${row.draw ? 'DRAW' : row.won ? 'VICTORY' : 'DEFEAT'} · ${label}${row.identity && supportsFog(getRuleset(row.identity.ruleset.id, row.identity.ruleset.revision)) ? ' · Fog' : ''} · ${timeText(Number.isFinite(row.time) ? row.time : 0)}`;
    $('battleHistory').append(p);
  }
}
$('settings').onclick = showSettings;
$('welcomeSettings').onclick = showSettings;
$('pauseSettings').onclick = showSettings;
$('closeSettings').onclick = hideSettings;
$('settingsDone').onclick = hideSettings;
// Fullscreen is optional and must start synchronously inside a button gesture.
// Target the document root so sibling dialogs and pause controls stay visible.
const fullscreenRoot = document.documentElement;
const fullscreenButtons = [...document.querySelectorAll('[data-fullscreen]')];
const fullscreenStatuses = [...document.querySelectorAll('[data-fullscreen-status]')];
const fullscreenAppView = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
let fullscreenPending = false;
let fullscreenFailure = '';
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}
function fullscreenAPI() {
  if (typeof fullscreenRoot.requestFullscreen === 'function') return {
    enabled: document.fullscreenEnabled === true,
    enter: () => fullscreenRoot.requestFullscreen({ navigationUI: 'hide' }),
    exit: typeof document.exitFullscreen === 'function' ? () => document.exitFullscreen() : null,
  };
  if (typeof fullscreenRoot.webkitRequestFullscreen === 'function') return {
    enabled: document.webkitFullscreenEnabled === true,
    enter: () => fullscreenRoot.webkitRequestFullscreen(),
    exit: typeof document.webkitExitFullscreen === 'function' ? () => document.webkitExitFullscreen() : null,
  };
  return { enabled: false };
}
function syncFullscreenControls() {
  const active = !!fullscreenElement(), api = fullscreenAPI();
  const available = active ? !!api.exit : api.enabled;
  const appView = fullscreenAppView.matches || navigator.standalone === true;
  const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
  for (const button of fullscreenButtons) {
    // Keep keyboard focus during an asynchronous request. Native disabled
    // would blur the button and let dialog focus restoration choose another.
    button.disabled = !available;
    button.setAttribute('aria-disabled', String(fullscreenPending || !available));
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = label;
  }
  const status = fullscreenFailure || (active
    ? 'Fullscreen is on. Use Exit fullscreen or your browser’s exit control.'
    : appView
      ? available
        ? 'App view is already active. Fullscreen is optional; system controls may remain.'
        : 'App view is already active. Extra fullscreen is unavailable; keep playing here.'
      : available
        ? 'Optional fullscreen can hide browser bars, though system controls may remain.'
        : 'Fullscreen is unavailable here. Keep playing in this window.');
  for (const node of fullscreenStatuses) node.textContent = status;
}
function fullscreenFailed() {
  const message = fullscreenElement()
    ? 'Could not leave fullscreen. Use your browser’s exit fullscreen control.'
    : 'Could not enter fullscreen. Try again or keep playing in this window.';
  const changed = fullscreenFailure !== message;
  fullscreenFailure = message;
  syncFullscreenControls();
  if (changed && $('settingsModal').classList.contains('hidden') && $('welcome').classList.contains('hidden')) toast(message);
}
for (const button of fullscreenButtons) button.addEventListener('click', async () => {
  const api = fullscreenAPI(), active = !!fullscreenElement();
  if (fullscreenPending || (active ? !api.exit : !api.enabled)) return;
  fullscreenPending = true;
  fullscreenFailure = '';
  syncFullscreenControls();
  try {
    // No await before the API call: transient user activation must survive.
    await (active ? api.exit() : api.enter());
  } catch {
    fullscreenFailed();
  } finally {
    fullscreenPending = false;
    syncFullscreenControls();
  }
});
for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, () => {
  resetBattleGesture();
  fullscreenFailure = '';
  syncFullscreenControls();
});
for (const name of ['fullscreenerror', 'webkitfullscreenerror']) document.addEventListener(name, fullscreenFailed);
const syncFullscreenAppView = () => { fullscreenFailure = ''; syncFullscreenControls(); };
if (fullscreenAppView.addEventListener) fullscreenAppView.addEventListener('change', syncFullscreenAppView);
else fullscreenAppView.addListener?.(syncFullscreenAppView);
syncFullscreenControls();
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
  $('coachingModal'),
  $('pauseVeil'),
  $('citadelModal'),
  $('viewportModal'),
  $('welcome'),
  $('helpModal'),
  $('settingsModal'),
  $('resultModal'),
  $('backupModal'),
  $('restartModal'),
];
let activeDialog = null;
const dialogFocus = new WeakMap();
const inputScope = createInputScopeGuard();
function syncInputScope() {
  const dialog = dialogLayers.findLast((layer) => !layer.classList.contains('hidden'));
  if (keyboardCapture && (dialog !== $('settingsModal') || !$('keyboardSettings').open || recoveryHold || profileGate || document.hidden))
    cancelKeyboardCapture();
  const next = (dialog?.id === 'viewportModal' ? viewportScope() : dialog) || (!$('pauseVeil').classList.contains('hidden')
    ? 'pause'
    : game.state.winner !== null || objectiveOutcome ? 'ended'
      : $('app').classList.contains('compact-build-open') ? 'compact-build'
        : $('app').classList.contains('protected-compact') ? `compact-battle:${mobileLayout}` : 'battle');
  if (inputScope.setScope(next)) resetBattleGesture();
}
function guardInput(event, check) {
  syncViewportSafety();
  // Read the DOM too: a scope can change during the same event turn, before
  // the MutationObserver has restored focus/inert state.
  syncInputScope();
  if (!check()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('pointerdown', (event) => {
  syncViewportSafety();
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
  if (!event.defaultPrevented) captureKeyboardInput(event);
}, true);
document.addEventListener('keyup', (event) => {
  guardInput(event, () => inputScope.keyUp(event));
}, true);
window.addEventListener('blur', () => {
  holdInterruptedDialogs();
  cancelKeyboardCapture();
  inputScope.interrupt();
  resetBattleGesture();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelKeyboardCapture();
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
  globalThis.queueMicrotask?.(syncMenuHistory);
  // A safety/recovery interruption takes precedence over a destructive prompt.
  if (!$('restartModal').classList.contains('hidden') &&
      (recoveryHold || profileGate || viewportPause.active || battleSafetyReason)) {
    $('restartModal').classList.add('hidden');
    syncInputScope();
  }
  if (!$('citadelModal').classList.contains('hidden') && (recoveryHold || profileGate || viewportPause.active || battleSafetyReason)) $('citadelModal').classList.add('hidden');
  if (!$('pauseVeil').classList.contains('hidden')) syncPauseMenu();
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
    const returning = previous && dialogFocus.get(previous);
    const target = returning && next.contains(returning) && !returning.disabled && controlIsVisible(returning)
      ? returning : null;
    if (!target) dialogFocus.set(next, document.activeElement);
    (target || dialogDefaultFocus(next))?.focus();
  } else {
    const target = previous && dialogFocus.get(previous);
    if (target?.isConnected && target !== document.body && target !== document.documentElement &&
        !target.closest('.hidden,[inert]')) target.focus();
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
  // Pointer taps on labels/text can leave focus on the body (notably when
  // their input is disabled). Repair the focus trap without moving a reader
  // away from the control they just tapped in a scrolled mobile dialog.
  // Explicit dialog entry and keyboard Tab navigation still reveal focus.
  dialogDefaultFocus(activeDialog)?.focus({ preventScroll: true });
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

// A viewport interruption is a pause reason, never a saved game field.
function viewportScope() { return battleSafetyReason ? 'battle-safety' : viewportPause.blocked ? 'viewport-blocked' : 'viewport-ready'; }
function interruptMobileInput() {
  inputScope.interrupt();
  resetBattleGesture();
  armedProtectedControl = null;
  armedReserveControl = null;
  closeSelectionArmed = false;
  controller.reset();
  padHud = false;
}
function syncViewportSafety() {
  const relevant = started && game.state.winner === null && !objectiveOutcome;
  if (!relevant) return;
  const mobile = $('app').classList.contains('protected-mobile');
  const viewport = visibleViewportRect(window.innerWidth, window.innerHeight, window.visualViewport);
  // Fit before measuring, also checking padding-only content changes on every
  // safety pass. A safe move still invalidates gestures from the previous rect.
  if (fitMobileViewport($('app'), viewport, mobile, mobile ? getComputedStyle($('app')) : {})) {
    // A track change interrupts and resizes inside syncProtectedLayout. A move
    // within the same tracks still needs exactly one gesture invalidation.
    if (!syncProtectedLayout()) {
      interruptMobileInput();
      renderer.resize();
    }
  }
  const panel = $('viewportModal');
  panel.style.left = `${viewport.left}px`; panel.style.top = `${viewport.top}px`;
  panel.style.width = `${viewport.width}px`; panel.style.height = `${viewport.height}px`;
  let geometry = {safe:true,reason:''};
  if (mobile) {
    const reserve = currentMinorReserve();
    const controls = ['pause','speed','sound','settings','home','front','minimap','compactBuild',
      ...(reserve && !reserve.ended ? ['focusMinorReserve'] : []),
      ...[...protectedControls.values()].map(c => c.button.id)].filter(Boolean).map(id => $(id).getBoundingClientRect());
    // Protected buttons use stable authored IDs in data attributes, not DOM IDs.
    for (const {button} of protectedControls.values()) if (!button.id) controls.push(button.getBoundingClientRect());
    const teaching = $('app').classList.contains('mobile-coaching');
    if (teaching) for (const id of ['coachResume', 'toggleCoach'])
      if (!$(id).classList.contains('hidden')) controls.push($(id).getBoundingClientRect());
    const safeContent = insetViewportRect(viewport, getComputedStyle($('app')));
    geometry = inspectMobileGeometry({viewport:safeContent,canvas:$('battle').getBoundingClientRect(),
      regions:['topbar','protectedDock','protectedNavigation', ...(teaching && !$('app').classList.contains('coach-collapsed') ? ['campaignTeaching'] : [])].map(id => $(id).getBoundingClientRect()),controls});
  }
  const wasActive = viewportPause.active;
  const changed = viewportPause.measure(!geometry.safe);
  if (!changed) return;
  interruptMobileInput();
  if (!wasActive && viewportPause.active) {
    cancel();
    $('viewportSaveStatus').textContent = '';
    pause(true);
  }
  panel.classList.toggle('hidden', !viewportPause.active);
  $('viewportResume').disabled = viewportPause.blocked || !!battleSafetyReason || !!game.limitReason;
  $('viewportTitle').textContent = viewportPause.blocked ? 'Battle paused for screen size' : 'Battle ready to resume';
  $('viewportReason').textContent = battleSafetyReason || game.limitReason || (viewportPause.blocked
    ? `${geometry.reason} Rotate your device or enlarge the window. Your battle stays paused.`
    : 'The battlefield fits again. Resume when you are ready.');
  syncDialogs();
}
window.visualViewport?.addEventListener('resize', () => { syncProtectedLayout(); syncViewportSafety(); });
window.visualViewport?.addEventListener('scroll', syncViewportSafety);

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
  setCompactBuildOpen(false);
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
  setCompactBuildOpen(false);
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
    setCompactBuildOpen(false);
    paused = true;
    if ($('backupModal').classList.contains('hidden')) showRecoverySettings();
  }
  if (recoveryHold || profileGate) updateRecoveryUI();
}
function reloadProfile() {
  const status = profileSession.status();
  if (!status.canReload || pendingFinalizeOutcome) return;
  // Import finalization clears the old gate. Re-establish it synchronously:
  // even identical imported battle bytes belong to the replacement profile.
  if (status.reloadRequired) profileGate = status;
  allowProfileReload = true;
  // Keep the retained attempt and menu ancestry until the document actually
  // leaves. Shortening this trail can make a queued menu sync call history.go()
  // during reload. Pausing and the profile fence already prevent stale writes.
  setCompactBuildOpen(false);
  paused = true;
  pendingBackupText = null;
  try { location.reload(); }
  catch (error) { allowProfileReload = false; throw error; }
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
        ? encodeBattle(game, scenarioForBattle(currentChallenge, currentCampaign, game), { campaignProgress })
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
      const storedCampaign = readCampaignProgressState(storage);
      if (!storedCampaign.ok) throw new Error('Stored campaign progress cannot be read safely. Use Export in-memory session to retain this tab’s known progress; it is not a complete saved-profile backup.');
      options.campaign = mergeCampaignProgress(campaignProgress, storedCampaign.progress);
      options.trials = trialRecords;
    }
    if (
      includeBattle &&
      started &&
      game.state.winner === null &&
      !objectiveOutcome &&
      battleSession.isCurrent()
    )
      options.battle = encodeBattle(game, scenarioForBattle(currentChallenge, currentCampaign, game),
        { campaignProgress: options.campaign || campaignProgress });
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
    const battle = parsed.data.battle;
    const admitted = battle ? decodeBattle(battle, { campaignProgress: parsed.data.campaign }) : null;
    const battleName = admitted
      ? admitted.campaignId ? CAMPAIGN_MISSIONS.find(m => m.id === admitted.campaignId).name
        : admitted.challengeId ? CHALLENGES.find(c => c.id === admitted.challengeId).name
          : `Skirmish · ${admitted.game.map.name}${supportsFog(admitted.game.ruleset) ? ' · Fog' : ''}` : null;
    $('backupSummary').textContent =
      `${overview.cleared}/${overview.total} campaign missions · ${overview.stars}/${overview.maxStars} stars · ${Object.keys(parsed.data.trials).length}/${CHALLENGES.length} trial records. ${battle ? `Saved battle: ${battleName} at ${timeText(battle.game.state.time)}.` : 'No battle in this file. Your current saved battle will be removed.'}`;
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
  if (dialog) return { mode: 'menu', key: dialog.id === 'viewportModal' ? viewportScope() : dialog.id, element: dialog };
  if (paused) return { mode: 'menu', key: 'pause', element: $('pauseVeil') };
  if (padHud || $('app').classList.contains('compact-build-open'))
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
  if (control.closest?.('#commandDeck')) {
    if (control.matches?.('.build-card, #rally') && ui.selected) { ui.selected = null; updateSelection(); }
    setCompactBuildOpen(true);
  }
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
  // These compact menus have a deliberate reading order. Spatial navigation
  // would jump from the centered Resume button past both utility buttons.
  if (scope.key === 'pauseVeil' || scope.key === 'restartModal') {
    focusPadControl(controls[nextFocusIndex(controls, current,
      ['left', 'up'].includes(direction) ? -1 : 1)]);
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
  if (scope.key === 'coachingModal') planWithCoaching();
  else if (scope.key === 'backupModal') hideBackup();
  else if (scope.key === 'settingsModal') hideSettings();
  else if (scope.key === 'helpModal') hideHelp();
  else if (scope.key === 'citadelModal') hideCitadelOptions();
  else if (scope.key === 'restartModal') hideRestart();
  else if (scope.key === 'pauseVeil' || scope.key === 'pause') pause(false, { explicit: true });
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
    if (scope.key === 'pauseVeil' || scope.key === 'pause') pause(false, { explicit: true });
    else if (scope.key === 'battle' || scope.key === 'hud') toggleBattlePause();
  } else if (action === 'cancel') controllerBack(scope);
  else if (action === 'focus') {
    if (scope.key === 'battle') {
      padHud = true;
      focusPadControl(document.querySelector('.build-card'));
    } else if (scope.key === 'hud') {
      setCompactBuildOpen(false);
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
      const types = campaignBuildChoices(currentCampaign, { expanded: expandedBuilds, resumed: resumedBattle, buildings: game.buildings || BUILDINGS }),
        index = types.indexOf(ui.build);
      const next = nextAffordableIndex(
        types.map((type) => (game.buildings || BUILDINGS)[type]),
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


// Browser/Android/PWA Back is history navigation, not a key binding. The finite
// trail exposes real parents and a paused battle boundary. No popstate handler
// pushes entries, restores a saved battle, restarts, or resumes simulation.
function menuNavigationTrail() {
  if (started && game !== navigationGame) { navigationGame = game; navigationAttempt++; }
  const route = (kind, key = kind, extra = {}) => ({kind, key, ...extra});
  const trail = [route('title', `title:${mode}`, {mode, page: 'story'})];
  if (mode === 'campaign') {
    if (started || campaignPage !== 'story') trail.push(route('title', `chapter:${selectedChapter}`, {
      mode, page: 'chapter', chapter: selectedChapter, mission: selectedCampaign,
    }));
    if (started || campaignPage === 'mission') trail.push(route('title', `mission:${selectedCampaign}`, {
      mode, page: 'mission', chapter: selectedChapter, mission: selectedCampaign,
    }));
  }
  if (started) {
    const ended = game.state.winner !== null || !!objectiveOutcome;
    trail.push(route(ended ? 'ended' : 'pause', `${ended ? 'ended' : 'battle'}:${navigationAttempt}`, {attempt: navigationAttempt}));
    if (!ended && !paused && !coachingHold && $('coachingModal').classList.contains('hidden'))
      trail.push(route('play', `play:${navigationAttempt}`, {attempt: navigationAttempt}));
  }
  for (const id of ['coachingModal', 'citadelModal', 'viewportModal', 'helpModal', 'settingsModal', 'resultModal', 'backupModal', 'restartModal']) {
    if (!$(id).classList.contains('hidden')) trail.push(route(id, `${navigationAttempt}:${id}`, {attempt: started ? navigationAttempt : null}));
  }
  if (started && !activeDialog && $('app').classList.contains('compact-build-open'))
    trail.push(route('build', `build:${navigationAttempt}`, {attempt: navigationAttempt}));
  if (started && !activeDialog && game.state.buildings.some(b => b.id === ui.selected && b.side === 0))
    trail.push(route('selection', `selection:${navigationAttempt}:${ui.selected}`, {attempt: navigationAttempt, buildingId: ui.selected}));
  if (!$('resultModal').classList.contains('hidden') && $('resultReport').querySelector('details')?.open)
    trail.push(route('report', `report:${navigationAttempt}`, {attempt: started ? navigationAttempt : null}));
  return trail;
}
function closeNavigationLayers(keep = null) {
  // Preserve mandatory recovery/viewport holds. Closing a menu via browser Back
  // never implicitly resumes a running battle, even if its visible Done does.
  if (keep !== 'report') {
    const report = $('resultReport').querySelector('details');
    if (report) report.open = false;
  }
  const retained = keep === 'backupModal' ? ['settingsModal', 'backupModal'] :
    keep === 'report' ? ['resultModal'] : [keep];
  if (!retained.includes('citadelModal')) $('citadelModal').classList.add('hidden');
  if (!retained.includes('restartModal')) $('restartModal').classList.add('hidden');
  if (!retained.includes('backupModal') && !$('backupModal').classList.contains('hidden')) hideBackup();
  if (!retained.includes('settingsModal') && !$('settingsModal').classList.contains('hidden')) {
    settingsWasPaused = true; hideSettings();
  }
  if (!retained.includes('helpModal') && !$('helpModal').classList.contains('hidden')) {
    helpWasPaused = true; hideHelp();
  }
  if (!retained.includes('resultModal')) $('resultModal').classList.add('hidden');
  if (keep !== 'coachingModal') $('coachingModal').classList.add('hidden');
  if (keep !== 'selection' && !activeDialog && ui.selected != null) { ui.selected = null; updateSelection(); }
  setCompactBuildOpen(keep === 'build' || keep === 'selection');
}
function applyMenuNavigation(route, {direction = 'back'} = {}) {
  const returnToPlanning = coachingHold && (
    !$('coachingModal').classList.contains('hidden') ||
    (!paused && ($('app').classList.contains('compact-build-open') || ui.selected != null)) ||
    (!$('settingsModal').classList.contains('hidden') && !settingsWasPaused) ||
    (!$('helpModal').classList.contains('hidden') && !helpWasPaused));
  interruptMobileInput();
  // Only this retained attempt can be inspected. Previous attempts and reload
  // markers cannot reconstruct a Game or take ownership of a checkpoint.
  if (route.attempt != null && (!started || route.attempt !== navigationAttempt)) {
    if (started) pause(true);
    syncDialogs(); return;
  }
  if (route.kind === 'title') {
    // Dismissing a title-screen layer is not a new campaign navigation. Keep
    // the existing page/scroll and let the real dialog handoff restore its
    // opener, rather than rebuilding the title and focusing its heading.
    const sameTitleParent = !started && !$('welcome').classList.contains('hidden') &&
      activeDialog && activeDialog !== $('welcome') && route.mode === mode &&
      (mode !== 'campaign' || (route.page === campaignPage &&
        (route.page === 'story' || route.chapter === selectedChapter) &&
        (route.page !== 'mission' || route.mission === selectedCampaign)));
    closeNavigationLayers();
    if (sameTitleParent) { syncDialogs(); return; }
    if (started && game.state.winner === null && !objectiveOutcome) {
      pause(true);
      $('saveExit').onclick();
      if (started) { syncDialogs(); return; }
    } else showTitle();
    // The route is an in-memory snapshot of an authored selection, not input
    // from event.state. Validate against the current roster before rendering.
    if (!['campaign', 'skirmish', 'challenges'].includes(route.mode)) return;
    if (route.mission && !CAMPAIGN_MISSIONS.some(m => m.id === route.mission && m.chapterId === route.chapter)) return;
    if (route.mission) { selectedCampaign = route.mission; selectedChapter = route.chapter; }
    campaignPage = ['story', 'chapter', 'mission'].includes(route.page) ? route.page : 'story';
    setMode(route.mode);
    syncDialogs();
    if (route.mode === 'campaign') $(`campaign${campaignPage[0].toUpperCase() + campaignPage.slice(1)}Title`).focus({preventScroll: true});
    return;
  }
  closeNavigationLayers(route.kind);
  if (returnToPlanning && ['pause', 'play'].includes(route.kind)) {
    // A teaching hold is already frozen. Back dismisses reading/options into
    // planning; only the player's explicit Start/Resume releases that hold.
    pause(false);
  } else if (route.kind === 'pause' || (direction === 'forward' && started && game.state.winner === null && !objectiveOutcome)) pause(true);
  if (route.kind === 'ended') {
    pauseControl('menu'); $('pause').onclick = showTitle;
  } else if (route.kind === 'settingsModal') {
    if (started) pause(true);
    settingsWasPaused = true; syncSettings();
    $('settingsDone').textContent = started ? 'Back to pause menu' : 'Done';
    $('settingsModal').classList.remove('hidden');
  } else if (route.kind === 'citadelModal') {
    showCitadelOptions();
  } else if (route.kind === 'helpModal') {
    if (started) pause(true);
    helpWasPaused = true; $('helpModal').classList.remove('hidden');
  } else if (route.kind === 'restartModal') {
    // Forward reopens only the confirmation, never its destructive action.
    if (started) pause(true);
    $('restartBattle').onclick();
  } else if (route.kind === 'backupModal') {
    // Cancel invalidates the import read. Forward cannot revive that payload.
    $('settingsModal').classList.remove('hidden');
  } else if (route.kind === 'resultModal' || route.kind === 'report') {
    if (resultShown) {
      if (!started) $('welcome').classList.add('hidden');
      $('resultModal').classList.remove('hidden');
    }
    const report = $('resultReport').querySelector('details');
    if (route.kind === 'report' && report && resultShown) report.open = true;
  } else if (route.kind === 'selection') {
    const building = game.state.buildings.find(b => b.id === route.buildingId && b.side === 0);
    ui.selected = building?.id ?? null; updateSelection();
  } else if (route.kind === 'coachingModal' && coachingHold && !firstBuildHold) {
    $('coachingModal').classList.remove('hidden');
  }
  syncDialogs();
}
function unknownMenuNavigation() {
  // Reloads/foreign states have no trusted route. Dismiss the current top
  // layer using the live UI, or stop combat. Never trust their payload.
  const trail = menuNavigationTrail();
  if (trail.length > 1) applyMenuNavigation(trail.at(-2));
  else if (started) pause(true);
}
menuHistory = createMenuHistory({
  history: window.history,
  seedAncestors: seedMenuAncestors(document.referrer, window.location.href),
  listen(handler) {
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  },
  read: menuNavigationTrail, apply: applyMenuNavigation, unknown: unknownMenuNavigation,
});
for (const event of ['click', 'keyup', 'change', 'toggle'])
  document.addEventListener(event, () => queueMicrotask(syncMenuHistory), true);
for (const id of ['app', 'selectionPanel'])
  new MutationObserver(syncMenuHistory).observe($(id), {attributes: true, attributeFilter: ['class']});

// A cached document can return without rerunning module initialization. Freeze
// before it leaves, and reconcile the existing entry on return without adding
// another guard or assuming that the browser actually retained the document.
window.addEventListener('pagehide', () => {
  holdInterruptedDialogs();
  navigationAway = true;
  interruptMobileInput();
  if (started && game.state.winner === null && !objectiveOutcome) pause(true);
});
window.addEventListener('pageshow', event => {
  navigationAway = false;
  if (!event.persisted) return;
  allowProfileReload = false;
  interruptMobileInput();
  if (started && game.state.winner === null && !objectiveOutcome) pause(true);
  syncDialogs();
  menuHistory.reconcile();
});

// Background-tab and page-departure pauses must not issue history.go() while
// the browser is navigating elsewhere. Reconcile once the page is visible.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !navigationAway) menuHistory.reconcile();
});
