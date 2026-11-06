import { BUILDINGS, buildBounds, upgradeCost } from './engine.js';
import { Renderer, iconSVG } from './render.js';
import { createInputScopeGuard } from './input-scope.js';
import { TRAINING_LESSONS, TrainingSession } from './training.js';

const BUILD_ORDER = ['barracks', 'archery', 'foundry', 'watchtower', 'mint', 'sanctum', 'aerie'];
const ACTION_STATES = new Set(['instruction', 'active']);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

/** Independent of DOM: a drag, a second contact or lost capture can never place. */
export function createTrainingGesture(threshold = 8) {
  let pointer = null;
  const contacts = new Set();
  let multiple = false;
  return {
    start(id, x, y) {
      contacts.add(id);
      if (contacts.size > 1) { multiple = true; pointer = null; return false; }
      if (multiple) return false;
      pointer = { id, x, y, lastX:x, moved:false };
      return true;
    },
    move(id, x, y) {
      if (!pointer || pointer.id !== id) return { pan:0, dragging:false };
      if (Math.hypot(x - pointer.x, y - pointer.y) > threshold) pointer.moved = true;
      const pan = pointer.moved ? x - pointer.lastX : 0;
      pointer.lastX = x;
      return { pan, dragging:pointer.moved };
    },
    end(id, x, y) {
      contacts.delete(id);
      if (multiple) {
        if (!contacts.size) multiple = false;
        pointer = null;
        return false;
      }
      if (!pointer || pointer.id !== id) return false;
      const tap = !pointer.moved && Math.hypot(x - pointer.x, y - pointer.y) <= threshold;
      pointer = null;
      return tap;
    },
    cancel(id) {
      if (id === undefined) { contacts.clear(); multiple = false; pointer = null; return; }
      contacts.delete(id);
      if (!contacts.size) multiple = false;
      if (pointer?.id === id) pointer = null;
    },
  };
}

/** Explicit selections are UI-only. Every paid mutation goes through the lesson. */
export function createTrainingChoices(session) {
  let build = null, selected = null;
  const reset = () => { build = null; selected = null; };
  return {
    get build() { return build; },
    get selected() { return selected; },
    reset,
    choose(type) {
      const state = session.snapshot();
      if (!ACTION_STATES.has(state.status) || !state.availableBuildings.includes(type))
        return { ok:false, reason:'This building is not available in the current step.' };
      build = type; selected = null;
      return { ok:true };
    },
    select(id) {
      const building = session.game.state.buildings.find((b) => b.id === id && b.side === 0 && b.hp > 0);
      if (!building) return { ok:false, reason:'Choose one of your living buildings.' };
      build = null; selected = id;
      return { ok:true };
    },
    place(x, y) {
      if (!build) return { ok:false, reason:'Choose a build card first. Then select a highlighted site.' };
      const result = session.build(build, x, y);
      if (result.ok) reset();
      return result;
    },
    upgrade() {
      if (selected === null) return { ok:false, reason:'Select your highlighted building first.' };
      const result = session.upgrade(selected);
      if (result.ok) reset();
      return result;
    },
  };
}

/** A fresh practice Game must not inherit frozen particles from an old one. */
export function syncTrainingVisuals(renderer, game, previousGame) {
  if (game !== previousGame) renderer.vfx.reset();
  return game;
}

export function trainingFeedback(snapshot, localFeedback = '') {
  const complete = ['step-complete', 'lesson-complete'].includes(snapshot.status);
  if (complete || snapshot.status === 'failed')
    return snapshot.feedback || snapshot.step?.successText || 'Step complete. Continue when you are ready.';
  if (localFeedback) return localFeedback;
  if (snapshot.status === 'active') {
    if (snapshot.paused)
      return snapshot.recovering ? 'Income wait paused. Resume when ready.' : 'Observation paused. Resume when ready.';
    return snapshot.recovering
      ? 'Waiting for real income. Combat also runs; practice pauses as soon as the action is affordable.'
      : 'Observation running at normal speed.';
  }
  return snapshot.feedback || '';
}

export function trainingActionLine(snapshot, choices = {}) {
  if (snapshot.status === 'finished') return 'Practice review below. No rewards or progress saved.';
  if (snapshot.status === 'failed') return 'Attempt ended. Restart or skip below.';
  if (['step-complete', 'lesson-complete'].includes(snapshot.status)) return 'Step complete. Continue below when you are ready.';
  if (snapshot.status === 'active') {
    if (snapshot.paused) return 'Time paused. Resume observation below.';
    return snapshot.recovering ? 'Waiting for income. Combat is running.' : `${snapshot.step.title} · observing`;
  }
  const step = snapshot.step || {};
  if (step.kind === 'build') {
    const data = BUILDINGS[choices.build || step.type];
    return choices.build ? `${data.name} selected · tap the gold ring (${data.cost} gold).` : `Choose ${data.name} below, then tap the gold ring.`;
  }
  if (step.kind === 'upgrade') return choices.selected != null ? `Mine selected. Upgrade below for ${snapshot.requiredGold} gold.` : 'Tap the gold-ringed mine, then choose Upgrade below.';
  if (step.kind === 'watch') return `${step.title} · Start observation below.`;
  return 'Follow the current lesson below.';
}

/** Minimal document scroll needed to uncover a coach control below the map. */
export function trainingCoachScroll(rect, fieldRect, viewportHeight) {
  const top = Math.min(fieldRect.bottom + 8, viewportHeight - 52), bottom = viewportHeight - 8;
  if (rect.top < top) return rect.top - top;
  if (rect.bottom > bottom) return Math.min(rect.bottom - bottom, rect.top - top);
  return 0;
}

/** Native pointer focus precedes click. Do not move its target mid-activation. */
export function createTrainingCoachAlignment({ align, schedule, cancel }) {
  let pendingFrame = null, latestPrimary = null, revision = 0;
  const contacts = new Map();
  function cancelPending() {
    revision++;
    if (pendingFrame !== null) cancel(pendingFrame);
    pendingFrame = null;
  }
  return {
    reveal(target) {
      cancelPending();
      if (contacts.size) return;
      align(target);
      const requested = revision;
      pendingFrame = schedule(() => {
        pendingFrame = null;
        if (requested === revision && !contacts.size) align(target);
      });
    },
    beginPointer(event) {
      const type = event.pointerType || 'mouse', primary = event.isPrimary !== false;
      // A new gesture supersedes an abandoned compatibility click of its own
      // device type. Keep every still-held contact, including other devices.
      if (primary) for (const [id, contact] of contacts)
        if (contact.released && contact.type === type) contacts.delete(id);
      const contact = { id:event.pointerId, type, primary, released:false };
      contacts.set(event.pointerId, contact);
      if (contact.primary) latestPrimary = contact;
      cancelPending();
    },
    // A touch pointerup is followed by compatibility mousedown/focus/click.
    // Non-primary contacts have no compatibility activation to retain.
    releasePointer(event) {
      const contact = contacts.get(event.pointerId);
      if (contact?.primary) contact.released = true;
      else contacts.delete(event.pointerId);
    },
    cancelPointer(event) { contacts.delete(event.pointerId); },
    endActivation(event) {
      if (event.isTrusted === false || event.detail === 0) return;
      let contact;
      if (Number.isFinite(event.pointerId) && event.pointerId >= 0) contact = contacts.get(event.pointerId);
      else if (event.sourceCapabilities?.firesTouchEvents || event.pointerType) {
        const type = event.sourceCapabilities?.firesTouchEvents ? 'touch' : event.pointerType;
        contact = [...contacts.values()].find((item) => item.primary && item.released && item.type === type);
      } else contact = latestPrimary;
      if (contact?.released && contacts.get(contact.id) === contact) contacts.delete(contact.id);
    },
    keyboard() {
      for (const [id, contact] of contacts) if (contact.released) contacts.delete(id);
    },
    interrupt() { cancelPending(); contacts.clear(); latestPrimary = null; },
  };
}

export function trainingClock(time) {
  const seconds = Math.floor(time + 1e-6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function trainingIncome(game) {
  return 5 + game.state.buildings.filter((b) => b.side === 0 && b.type === 'mint' && b.hp > 0).reduce((sum,b) => sum + BUILDINGS.mint.income * (1 + 0.5 * (b.level - 1)), 0);
}

export function trainingScope(snapshot) {
  return [snapshot.attemptId, snapshot.lessonIndex, snapshot.stepIndex, snapshot.status, snapshot.paused].join(':');
}

export function bootTraining(doc = document) {
  const $ = (id) => doc.getElementById(id);
  let session = new TrainingSession();
  const renderer = new Renderer($('trainingBattle'), $('trainingMinimap'));
  let choices = createTrainingChoices(session);
  const inputScope = createInputScopeGuard();
  const gesture = createTrainingGesture();
  const miniGesture = createTrainingGesture();
  const ui = { build:null, selected:null, pointer:null, dragging:false, paused:true, targets:[] };
  let snapshot = session.snapshot(), scope = null, stepKey = null, feedback = '', leaving = false, lastFrame = 0, hudElapsed = 0;
  let miniPointer = null, visualGame = null;

  function resetGesture() {
    gesture.cancel(); miniGesture.cancel(); miniPointer = null;
    ui.dragging = false; ui.pointer = null;
    $('trainingBattle').classList.remove('dragging');
  }
  const portrait = () => matchMedia('(max-width:650px) and (orientation:portrait)').matches;
  function resize() {
    renderer.resize();
    // Portrait keeps the original 0.32 floor for legible units in a compact
    // sticky field. Its 200px minimum canvas still contains all three lanes.
    // Keep the existing full-height fit for landscape, without engine changes.
    renderer.scale = Math.max(portrait() ? 0.32 : 0.12, renderer.height / session.game.map.height) * renderer.zoom;
    renderer.clampCamera();
    doc.documentElement.style.setProperty('--training-sticky-height', `${$('fieldPanel').getBoundingClientRect().height}px`);
  }
  const coachAlignment = createTrainingCoachAlignment({
    align(target) {
      if (!target?.isConnected || !portrait() || !target.closest('.coach')) return;
      const delta = trainingCoachScroll(target.getBoundingClientRect(), $('fieldPanel').getBoundingClientRect(), window.innerHeight);
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    },
    schedule: requestAnimationFrame,
    cancel: cancelAnimationFrame,
  });
  function revealCoachControl(target) {
    if (!portrait() || !target?.closest('.coach')) return;
    coachAlignment.reveal(target);
  }
  function focusStep() { $('stepTitle').focus({ preventScroll:true }); revealCoachControl($('stepTitle')); }
  function camera(target) {
    if (target === 'home') renderer.camera = 700;
    else if (target === 'front') {
      const targets = snapshot.targetHints || [];
      const enemy = targets.find((h) => h.side === 1);
      const own = session.game.state.units.filter((u) => u.side === 0 && u.hp > 0);
      renderer.camera = enemy?.x ?? (own.length ? Math.max(...own.map((u) => u.x)) : session.game.state.frontline);
    }
    renderer.clampCamera();
    updateMinimapDescription();
  }
  function updateMinimapDescription() {
    $('trainingMinimap').setAttribute('aria-valuemax', String(session.game.map.width));
    $('trainingMinimap').setAttribute('aria-valuenow', String(Math.round(renderer.camera)));
    $('trainingMinimap').setAttribute('aria-valuetext', `${Math.round(renderer.camera / session.game.map.width * 100)} percent across the battlefield`);
  }
  function perform(action, { focus = false } = {}) {
    if (leaving) return;
    const result = action();
    feedback = result?.ok === false ? result.reason || 'That action is not available yet.' : '';
    refresh();
    if (focus) focusStep();
    return result;
  }
  function refresh() {
    snapshot = session.snapshot();
    visualGame = syncTrainingVisuals(renderer, session.game, visualGame);
    const nextScope = trainingScope(snapshot);
    if (inputScope.setScope(nextScope)) {
      resetGesture();
      // Keep a chosen build only while remaining in its current instruction.
      // A result, replay, pause or new step always requires a fresh selection.
      choices.reset();
      scope = nextScope;
    }
    const key = [snapshot.attemptId, snapshot.lessonIndex, snapshot.stepIndex].join(':');
    const newStep = key !== stepKey;
    if (newStep) {
      stepKey = key;
      feedback = '';
      renderer.setMap(session.game.map);
      resize();
      const target = snapshot.targetHints?.find((h) => h.side === 0) || snapshot.targetHints?.[0];
      renderer.camera = target?.x ?? 700;
      renderer.clampCamera();
      const allowed = snapshot.availableBuildings || [];
      $('buildDeck').innerHTML = allowed.length ? allowed.map((type) => {
        const data = BUILDINGS[type];
        return `<button type="button" class="build-card" data-build="${esc(type)}" aria-pressed="false" title="Choose ${esc(data.name)} (${BUILD_ORDER.indexOf(type) + 1})">${iconSVG(type)}<span><strong>${esc(data.name)}</strong><small>${data.cost} gold · key ${BUILD_ORDER.indexOf(type) + 1}</small></span></button>`;
      }).join('') : '<p class="deck-empty">No new build needed in this step.</p>';
      const hints = snapshot.targetHints || [];
      $('siteActions').innerHTML = hints.map((hint, index) => hint.side === 0 && !hint.buildingId ? `<button type="button" data-site-index="${index}">Place at ${esc(hint.label || 'highlighted site')}</button>` : '').join('');
      $('buildingActions').innerHTML = hints.map((hint) => hint.side === 0 && hint.buildingId && snapshot.step?.kind === 'upgrade' ? `<button type="button" data-building-id="${hint.buildingId}">Select ${esc((hint.label || BUILDINGS[session.game.state.buildings.find((b) => b.id === hint.buildingId)?.type]?.name || 'highlighted building').replace(/^Select /i, ''))}</button>` : '').join('');
    }
    const lesson = snapshot.lesson || {};
    const step = snapshot.step || {};
    const finished = snapshot.status === 'finished';
    doc.body.dataset.trainingStatus = snapshot.status;
    doc.body.dataset.lessonId = lesson.id || '';
    doc.body.dataset.stepId = step.id || '';
    doc.body.dataset.trainingPaused = String(snapshot.paused);
    const failed = snapshot.status === 'failed';
    const complete = ['step-complete', 'lesson-complete'].includes(snapshot.status);
    $('lessonPicker').value = lesson.id || '';
    $('lessonNumber').textContent = finished ? 'PRACTICE REVIEW' : `LESSON ${snapshot.lessonIndex + 1} / ${TRAINING_LESSONS.length}`;
    $('stepCount').textContent = step.id ? `STEP ${snapshot.stepIndex + 1}` : '';
    $('lessonName').textContent = finished ? 'Your practice review' : lesson.name || 'Guided practice';
    $('lessonSubtitle').textContent = finished ? `${snapshot.summary.completed} completed · ${snapshot.summary.skipped} skipped · ${snapshot.summary.failed} failed. Replay any lesson, or return to your game.` : lesson.subtitle || lesson.description || '';
    $('setupSummary').textContent = `Authored practice setup · ${lesson.startingGold} starting gold · no enemy AI`;
    $('setupBriefing').innerHTML = (lesson.briefing || []).map((line) => `<li>${esc(line)}</li>`).join('');
    $('stepKind').textContent = finished ? 'SESSION REVIEW' : failed ? 'TRY AGAIN' : complete ? 'WELL DONE' : snapshot.shouldRun ? 'WATCH THE BATTLE' : snapshot.paused && snapshot.status === 'active' ? 'OBSERVATION PAUSED' : 'YOUR TURN · TIME STOPPED';
    $('stepTitle').textContent = finished ? 'Training never changes your saved game.' : failed ? 'Restart for another attempt' : step.title || 'Lesson complete';
    $('stepPrompt').textContent = finished ? 'This review describes this page session only. Skipped lessons are not completions. Replay a lesson from the menu, or return to your unchanged game. No rewards or progress were saved.' : step.prompt || lesson.briefing || '';
    const objective = typeof snapshot.objective === 'string' ? snapshot.objective : snapshot.objective?.text || snapshot.objective?.description || '';
    $('objective').textContent = finished || objective === step.prompt ? '' : objective;
    $('reviewResults').hidden = !finished;
    if (finished) $('reviewResults').innerHTML = TRAINING_LESSONS.map((item) => { const result = snapshot.results.find((result) => result.lessonId === item.id); return `<li><span>${esc(item.name)}</span><strong>${esc(result?.outcome || 'not attempted')}</strong></li>`; }).join('');
    const statusText = trainingFeedback(snapshot, feedback);
    if ($('feedback').textContent !== statusText) $('feedback').textContent = statusText;
    $('continueLesson').hidden = !snapshot.canContinue || finished;
    $('continueLesson').textContent = snapshot.continueLabel || 'Continue';
    $('pauseLesson').hidden = snapshot.status !== 'active';
    $('pauseLesson').textContent = snapshot.paused ? 'Resume observation' : 'Pause observation';
    $('recoverGold').hidden = !snapshot.canRecoverGold;
    $('skipLesson').disabled = finished;
    $('restartLesson').disabled = snapshot.status === 'exited';
    $('fieldAction').textContent = trainingActionLine(snapshot, choices);
    $('fieldState').textContent = finished ? 'PRACTICE FINISHED · TIME STOPPED' : failed ? 'ATTEMPT ENDED · TIME STOPPED' : snapshot.shouldRun ? 'OBSERVING · TIME RUNNING' : snapshot.status === 'active' && snapshot.paused ? 'PAUSED · RESUME WHEN READY' : 'INSTRUCTIONS · TIME STOPPED';
    const actionsAllowed = ACTION_STATES.has(snapshot.status);
    for (const button of $('buildDeck').querySelectorAll('[data-build]')) {
      button.disabled = !actionsAllowed || !snapshot.availableBuildings.includes(button.dataset.build);
      button.setAttribute('aria-pressed', String(button.dataset.build === choices.build));
    }
    for (const button of $('siteActions').querySelectorAll('button')) button.disabled = !actionsAllowed || !choices.build;
    for (const button of $('buildingActions').querySelectorAll('button')) button.disabled = !actionsAllowed;
    $('cancelChoice').disabled = !choices.build && choices.selected === null;
    $('choiceHint').textContent = choices.build ? `${BUILDINGS[choices.build].name} selected. Tap the highlighted site or use its button below. Dragging never places it.` : choices.selected !== null ? 'Owned building selected. Upgrade spends the displayed gold.' : 'Choose a building, then a marked site. Nothing is placed for you.';
    const selected = session.game.state.buildings.find((b) => b.id === choices.selected && b.side === 0 && b.hp > 0);
    $('selectionPanel').hidden = !selected;
    if (selected) {
      $('selectionName').textContent = `${BUILDINGS[selected.type].name} · Level ${selected.level} · ${Math.ceil(selected.hp)} / ${selected.maxHp} health`;
      $('upgradeBuilding').textContent = selected.level >= 3 ? 'Maximum level' : `Upgrade · ${upgradeCost(selected)} gold`;
      $('upgradeBuilding').disabled = snapshot.status !== 'instruction' || snapshot.step?.kind !== 'upgrade' || snapshot.paused || selected.level >= 3;
    }
    ui.build = choices.build; ui.selected = choices.selected;
    ui.paused = !snapshot.shouldRun;
    ui.targets = (snapshot.targetHints || []).filter((h) => h.buildingId).map((h) => h.buildingId);
    updateHUD();
    if (newStep) updateMinimapDescription();
  }
  function updateHUD() {
    const state = session.game.state;
    $('gold').textContent = String(Math.floor(state.gold[0]));
    $('income').textContent = `+${Number(trainingIncome(session.game).toFixed(2))}/s`;
    $('battleTime').textContent = trainingClock(state.time);
  }
  function drawHints() {
    if (!ACTION_STATES.has(snapshot.status)) return;
    const c = renderer.c;
    c.save();
    c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    for (const [index, hint] of (snapshot.targetHints || []).entries()) {
      if (!Number.isFinite(hint.x) || !Number.isFinite(hint.y)) continue;
      const p = renderer.worldToScreen(hint.x, hint.y);
      const radius = Math.max(19, 52 * renderer.scale);
      c.lineWidth = 2;
      c.strokeStyle = hint.side === 1 ? '#ffcf9e' : '#ffe3a4';
      c.fillStyle = '#f7dd8b20';
      c.beginPath(); c.arc(p.x, p.y, radius, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#17281f'; c.beginPath(); c.arc(p.x, p.y - radius, 10, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffe3a4'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(index + 1), p.x, p.y - radius);
    }
    c.restore();
  }
  function localPoint(event, element) {
    const rect = element.getBoundingClientRect();
    return { x:event.clientX - rect.left, y:event.clientY - rect.top };
  }
  function activatePoint(point) {
    if (!ACTION_STATES.has(snapshot.status)) return;
    if (choices.build) {
      const bounds = buildBounds(session.game.map, 0);
      if (point.x < bounds.minX - 20 || point.x > bounds.maxX + 70 || point.y < bounds.minY - 15 || point.y > bounds.maxY + 20)
        return perform(() => ({ ok:false, reason:'That is outside your frontier. Use Home or the marked site button.' }));
      const site = renderer.snap(point);
      return perform(() => choices.place(site.x, site.y));
    }
    const nearest = session.game.state.buildings.filter((b) => b.side === 0 && b.hp > 0).sort((a,b) => Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
    if (nearest && Math.hypot(nearest.x-point.x,nearest.y-point.y) < 95) perform(() => choices.select(nearest.id));
    else { choices.reset(); refresh(); }
  }
  const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  doc.addEventListener('pointerdown', (event) => { coachAlignment.beginPointer(event); inputScope.pointerDown(event); }, { capture:true });
  doc.addEventListener('pointerup', (event) => { coachAlignment.releasePointer(event); if (inputScope.pointerEnd(event)) { resetGesture(); stop(event); } }, { capture:true });
  doc.addEventListener('pointercancel', (event) => { coachAlignment.cancelPointer(event); inputScope.pointerEnd(event, true); resetGesture(); }, { capture:true });
  doc.addEventListener('click', (event) => { coachAlignment.endActivation(event); if (inputScope.click(event)) stop(event); }, { capture:true });
  doc.addEventListener('keydown', (event) => { coachAlignment.keyboard(); if (inputScope.keyDown(event)) stop(event); }, { capture:true });
  doc.addEventListener('keyup', (event) => { if (inputScope.keyUp(event)) stop(event); }, { capture:true });
  $('trainingBattle').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const p = localPoint(event, $('trainingBattle'));
    if (gesture.start(event.pointerId, p.x, p.y)) $('trainingBattle').setPointerCapture(event.pointerId);
  });
  $('trainingBattle').addEventListener('pointermove', (event) => {
    const p = localPoint(event, $('trainingBattle'));
    ui.pointer = renderer.screenToWorld(p.x,p.y);
    const movement = gesture.move(event.pointerId,p.x,p.y);
    if (movement.dragging) {
      renderer.pan(movement.pan); ui.dragging = true;
      $('trainingBattle').classList.add('dragging'); updateMinimapDescription();
    }
  });
  $('trainingBattle').addEventListener('pointerup', (event) => {
    const p = localPoint(event, $('trainingBattle'));
    const tap = gesture.end(event.pointerId,p.x,p.y);
    ui.dragging = false; $('trainingBattle').classList.remove('dragging');
    if (tap) activatePoint(renderer.screenToWorld(p.x,p.y));
  });
  $('trainingBattle').addEventListener('pointercancel', () => resetGesture());
  $('trainingBattle').addEventListener('lostpointercapture', () => resetGesture());
  $('trainingBattle').addEventListener('pointerleave', () => { if (!ui.dragging) ui.pointer = null; });
  $('trainingBattle').addEventListener('wheel', (event) => {
    event.preventDefault(); renderer.pan(-(Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)); updateMinimapDescription();
  }, { passive:false });
  $('trainingMinimap').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const p = localPoint(event, $('trainingMinimap'));
    if (miniGesture.start(event.pointerId,p.x,p.y)) {
      miniPointer = event.pointerId; $('trainingMinimap').setPointerCapture(event.pointerId);
    }
  });
  $('trainingMinimap').addEventListener('pointermove', (event) => {
    const p = localPoint(event, $('trainingMinimap'));
    miniGesture.move(event.pointerId,p.x,p.y);
  });
  $('trainingMinimap').addEventListener('pointerup', (event) => {
    const p = localPoint(event, $('trainingMinimap'));
    const tap = miniGesture.end(event.pointerId,p.x,p.y);
    if (event.pointerId === miniPointer && tap) {
      renderer.camera = p.x / $('trainingMinimap').getBoundingClientRect().width * session.game.map.width;
      renderer.clampCamera(); updateMinimapDescription();
    }
    miniPointer = null;
  });
  $('trainingMinimap').addEventListener('lostpointercapture', () => { miniGesture.cancel(); miniPointer = null; });
  $('homeCamera').onclick = () => camera('home');
  $('frontCamera').onclick = () => camera('front');
  $('buildDeck').onclick = (event) => {
    const button = event.target.closest('[data-build]');
    if (button && !button.disabled) { perform(() => choices.choose(button.dataset.build)); revealCoachControl(button); }
  };
  $('siteActions').onclick = (event) => {
    const button = event.target.closest('[data-site-index]');
    if (button && !button.disabled) {
      const hint = snapshot.targetHints[Number(button.dataset.siteIndex)];
      perform(() => choices.place(hint.x,hint.y)); revealCoachControl(button);
    }
  };
  $('buildingActions').onclick = (event) => {
    const button = event.target.closest('[data-building-id]');
    if (button && !button.disabled) perform(() => choices.select(Number(button.dataset.buildingId)));
  };
  $('upgradeBuilding').onclick = () => perform(() => choices.upgrade());
  $('cancelChoice').onclick = () => { choices.reset(); feedback = 'Choice cancelled. No gold spent.'; refresh(); };
  $('continueLesson').onclick = () => perform(() => session.continue(), { focus:true });
  $('pauseLesson').onclick = () => perform(() => session.setPaused(!snapshot.paused));
  $('recoverGold').onclick = () => perform(() => session.recoverGold(), { focus:true });
  $('restartLesson').onclick = () => perform(() => session.retry(), { focus:true });
  $('skipLesson').onclick = () => perform(() => session.skip(), { focus:true });
  $('lessonPicker').onchange = () => perform(() => session.startLesson($('lessonPicker').value), { focus:true });
  $('returnGame').addEventListener('click', () => { leaving = true; session.exit(); coachAlignment.interrupt(); inputScope.setScope('exited'); inputScope.interrupt(); resetGesture(); });

  doc.addEventListener('focusin', (event) => revealCoachControl(event.target));
  // Once click has selected its target, uncover the resulting focused control.
  // Continue/Retry can intentionally transfer focus to the new step heading.
  doc.addEventListener('click', () => revealCoachControl(doc.activeElement));
  doc.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') { event.preventDefault(); choices.reset(); feedback = 'Choice cancelled. No gold spent.'; refresh(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.target?.closest('button,a,select,input,textarea,summary,[contenteditable="true"]')) return;
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault(); renderer.pan(event.code === 'ArrowLeft' ? 75 : -75); updateMinimapDescription(); return;
    }
    if (event.repeat) return;
    const digit = /^Digit([1-7])$/.exec(event.code);
    if (digit) { event.preventDefault(); perform(() => choices.choose(BUILD_ORDER[Number(digit[1])-1])); }
    else if (event.code === 'KeyH' || event.code === 'Home') { event.preventDefault(); camera('home'); }
    else if (event.code === 'KeyF' || event.code === 'End') { event.preventDefault(); camera('front'); }
    else if (event.code === 'Space' && snapshot.status === 'active') { event.preventDefault(); perform(() => session.setPaused(!snapshot.paused)); }
  });
  function interrupt() {
    coachAlignment.interrupt(); inputScope.interrupt(); resetGesture();
    if (snapshot.shouldRun) {
      session.setPaused(true);
      feedback = 'Observation paused while you were away. Resume when ready.';
    }
    lastFrame = 0; refresh();
  }
  window.addEventListener('blur', interrupt);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) interrupt(); });
  window.addEventListener('pagehide', () => { leaving = true; session.exit(); coachAlignment.interrupt(); inputScope.interrupt(); resetGesture(); });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      leaving = false; session = new TrainingSession(); choices = createTrainingChoices(session);
      coachAlignment.interrupt(); inputScope.interrupt(); inputScope.setScope('restored-page'); stepKey = null; lastFrame = 0; refresh();
    }
  });
  const fieldResize = new ResizeObserver(resize);
  fieldResize.observe($('canvasWrap'));
  fieldResize.observe($('fieldPanel'));
  $('lessonPicker').innerHTML = TRAINING_LESSONS.map((lesson,index) => `<option value="${esc(lesson.id)}">${index+1}. ${esc(lesson.name)}</option>`).join('');
  refresh();
  function frame(now) {
    const dt = lastFrame ? Math.min((now-lastFrame)/1000,0.1) : 0;
    lastFrame = now;
    if (!leaving && !doc.hidden) {
      if (snapshot.shouldRun) {
        session.update(dt);
        const next = session.snapshot();
        if (trainingScope(next) !== scope) refresh();
        else { snapshot = next; hudElapsed += dt; if (hudElapsed >= 0.15) { updateHUD(); hudElapsed = 0; } }
      }
      ui.paused = !snapshot.shouldRun;
      renderer.draw(session.game,ui,dt); drawHints();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // No globals or persisted progress: the session is owned by this page only.
}

if (typeof document !== 'undefined' && document.getElementById('trainingBattle')) bootTraining();
