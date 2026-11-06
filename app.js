import { Game, BUILDINGS, UNITS, LANES, SPELL, upgradeCost } from './engine.js';
import { Renderer, iconSVG } from './render.js';
import {
  CHALLENGES,
  createChallenge,
  getChallengeTargets,
  evaluateChallenge,
} from './challenges.js';
import {
  createStorage,
  createSaveSession,
  readHistory,
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
const storage = createStorage(() => localStorage);
let saveWarning = false;
const SETTINGS = 'ironroot.settings.v1',
  SAVE = 'ironroot.battle.v1',
  HISTORY = 'ironroot.history.v1',
  TRIALS = 'ironroot.trials.v1';
const battleSession = createSaveSession(storage, SAVE);
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
  const saved = JSON.parse(storage.get(SETTINGS) || '{}');
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
function savePreferences() {
  preferences.sound = soundOn;
  storage.set(SETTINGS, JSON.stringify(preferences));
}
function timeText(t) {
  const sec = Math.floor(t + 1e-6);
  return `${Math.floor(sec / 60)
    .toString()
    .padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
}
function toast(text) {
  $('toast').textContent = text;
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
  return started && !paused && game.state.winner === null && !objectiveOutcome;
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
      : innerWidth < 701
        ? 'Swipe for more buildings. Choose one, then tap a green slot.'
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
    `<span>♥ ${Math.ceil(b.hp)} / ${b.maxHp}</span><span>${d.unit ? `${(d.spawnTime / (1 + 0.22 * (b.level - 1)) / (game.state.overtime ? 1.65 : 1)).toFixed(1)}s / wave` : d.range ? `Range ${d.range}` : `+${(2.5 * (1 + 0.5 * (b.level - 1))).toFixed(1)} gold /s`}</span>`;
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
  if (!started || game.state.winner !== null || objectiveOutcome) return;
  if (!value && !battleSession.isCurrent()) {
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
  if (!battleSession.isCurrent()) {
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
        : new Game({ difficulty, seed: Date.now() >>> 0 }));
  if (!currentChallenge && !currentCampaign) {
    difficulty = game.difficulty;
    document
      .querySelectorAll('[data-difficulty]')
      .forEach((b) =>
        b.classList.toggle('active', b.dataset.difficulty === difficulty),
      );
  }
  battleSession.claim();
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
$('start').onclick = () => start();
function showTitle() {
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
  if (
    !started ||
    game.state.winner !== null ||
    objectiveOutcome ||
    typeof game.serialize !== 'function'
  )
    return false;
  if (!battleSession.isCurrent()) return false;
  const ok = writeBattle(
    battleSession,
    SAVE,
    game,
    currentChallenge,
    currentCampaign,
  );
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
    button.textContent = `RESUME ${mid ? 'MISSION' : cid ? 'TRIAL' : 'BATTLE'} · ${timeText(valid.state.time)}`;
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
  battleSession.remove();
  sound(won ? 'win' : 'lose');
  const history = readHistory(storage, HISTORY);
  history.unshift({
    won,
    draw,
    challengeId: currentChallenge,
    campaignId: currentCampaign,
    difficulty: game.difficulty,
    time: game.state.time,
    kills: game.state.stats.kills[0],
    built: game.state.stats.built[0],
    date: new Date().toISOString(),
  });
  storage.set(HISTORY, JSON.stringify(history.slice(0, 30)));
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
  if (ui.build) {
    if (w.x < 180 || w.x > 1390 || w.y < 165 || w.y > 740) {
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
});
$('battle').addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) multiTouch = false;
  pointer = null;
  ui.dragging = false;
  $('battle').classList.remove('dragging');
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
$('minimap').addEventListener('pointerdown', (e) => {
  const r = $('minimap').getBoundingClientRect();
  renderer.camera = ((e.clientX - r.left) / r.width) * 3200;
  renderer.clampCamera();
  follow = false;
});
window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
  if (e.code === 'Escape') {
    if (!$('settingsModal').classList.contains('hidden')) hideSettings();
    else if (!$('helpModal').classList.contains('hidden')) hideHelp();
    else cancel();
  }
  if (
    !started ||
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
  if (document.hidden && started && !paused && game.state.winner === null)
    pause(true);
  last = performance.now();
});
window.addEventListener('beforeunload', (e) => {
  if (progressDirty) persistProgress();
  if (
    progressDirty ||
    (started &&
      game.state.winner === null &&
      !objectiveOutcome &&
      battleSession.isCurrent() &&
      !save())
  ) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('storage', (event) => {
  if (event.key === 'ironroot.campaign.v1') {
    campaignProgress = mergeCampaignProgress(
      campaignProgress,
      readCampaignProgress(storage),
    );
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
let hudTimer = 0;
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
        : 'THE LONG REACH<small>THREE LANES · ONE FRONTIER</small>';
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
function renderCampaign() {
  const overview = getCampaignOverview(campaignProgress),
    mission =
      CAMPAIGN_MISSIONS.find((m) => m.id === selectedCampaign) ||
      CAMPAIGN_MISSIONS[0],
    chapter =
      CAMPAIGN_CHAPTERS.find((c) => c.id === selectedChapter) ||
      CAMPAIGN_CHAPTERS[0];
  $('campaignProgressText').textContent =
    `${overview.cleared}/12 missions · ${overview.stars}/36 stars`;
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
  }
}
renderChallenge();
renderCampaign();
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
  const rows = readHistory(storage, HISTORY).slice(0, 5);
  $('battleHistory').textContent = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.textContent = 'Your completed battles will appear here.';
    $('battleHistory').append(p);
  }
  for (const row of rows) {
    const p = document.createElement('p');
    const label = row.campaignId
      ? CAMPAIGN_MISSIONS.find((m) => m.id === row.campaignId)?.name ||
        'Campaign'
      : row.challengeId
        ? CHALLENGES.find((c) => c.id === row.challengeId)?.name ||
          'Field trial'
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
];
let activeDialog = null;
const dialogFocus = new WeakMap();
function syncDialogs() {
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
    const target = next.querySelector('button:not([disabled])');
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
  activeDialog.querySelector('button:not([disabled])')?.focus();
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
  const items = [
    ...activeDialog.querySelectorAll(
      'button:not([disabled]),a[href],input,select,summary,[tabindex="0"]',
    ),
  ].filter((x) => !x.closest('.hidden'));
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
