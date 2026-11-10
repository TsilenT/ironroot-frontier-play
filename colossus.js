/** The Last Engine: production identity; bounded surprise counterpush revision. */
import {RULESETS} from './rulesets.js';
import {COLOSSUS_IDS,COLOSSUS,ENCOUNTER} from './colossus-spec.js';
export {COLOSSUS_IDS,COLOSSUS,ENCOUNTER} from './colossus-spec.js';
export const supportsColossus = rules => !!rules && RULESETS[rules.id] === rules && rules.revision === 1 && rules.id === COLOSSUS_IDS[0];
export const isColossus = unit => unit?.type === 'colossus';
export const bodyDistance = (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - (isColossus(a) || isColossus(b) ? COLOSSUS.radius : 0));
export const createColossusState = () => ({revision: 2, motion: null, phase: 'armed', triggeredAt: null, bossId: null, defeatedAt: null, coreFellAt: null, playerFellAt: null, endedAt: null});
export const colossusAftermathAlive = game => supportsColossus(game?.ruleset) && game.ruleset.id === COLOSSUS_IDS[0] && game.state.winner === null && game.state.bases[0].hp > 0 && game.state.colossus.phase === 'active';

/** Boss keeps marching while attacking. Ordinary stop-to-fight cannot pin it. */
export function stepColossusUnit(game, boss, dt) {
  const s = game.state, phase = s.colossus;
  boss.cooldown = Math.max(-1, boss.cooldown - dt);
  boss.attack = Math.max(0, boss.attack - dt); boss.hit = Math.max(0, (boss.hit || 0) - dt);
  if (game.tick < phase.triggeredAt + ENCOUNTER.emergeTicks) return;
  const ownCore = s.bases[0];
  if (boss.cooldown <= 0) {
    const targets = [...s.units, ...s.buildings, ownCore].filter(e => e.side === 0 && e.hp > 0 && bodyDistance(boss, e) <= COLOSSUS.range + (e.type === 'base' ? 55 : 0));
    if (targets.length) {
      for (const e of targets) {
        const structure = !Object.hasOwn(game.units, e.type);
        const damage = e.type === 'base' ? ENCOUNTER.coreDamage : COLOSSUS.damage;
        game._damage(e, damage * (structure && s.overtime ? 1.75 : 1), 1);
      }
      boss.attack = .22; boss.cooldown = COLOSSUS.attackTime;
      game._effect(boss.x, boss.y, 'blast', 1, .7, 180);
    }
  }
  // Fast approach across empty enemy territory, then ordinary physical siege pace.
  // The boundary is geographic: casualties never govern this transition.
  const motion = phase.motion, approaching = boss.x > ENCOUNTER.siegeBoundary;
  motion[approaching ? 'approachTicks' : 'siegeTicks']++;
  const x = approaching ? Math.max(ENCOUNTER.siegeBoundary, boss.x - ENCOUNTER.approachSpeed * dt)
    : Math.max(ownCore.x + 55 + COLOSSUS.radius + COLOSSUS.range, boss.x - COLOSSUS.speed * dt);
  return {x, y: 450};
}

/** Called atomically after ordinary simultaneous damage, before victory. */
export function advanceColossus(game) {
  const s = game.state, phase = s.colossus;
  if (s.bases[1].hp === 0 && phase.coreFellAt === null) phase.coreFellAt = game.tick;
  if (s.bases[0].hp === 0 && phase.playerFellAt === null) phase.playerFellAt = game.tick;
  if (phase.phase === 'armed' && s.bases[0].hp > 0 && s.bases[1].hp <= ENCOUNTER.triggerHp) {
    const boss = {id: game.nextId++, type: 'colossus', flying: false, side: 1, x: game.map.width - 280, y: 450, lane: 1,
      hp: COLOSSUS.hp, maxHp: COLOSSUS.hp, level: 1, cooldown: 0, attack: 0};
    phase.motion = {approachTicks: 0, siegeTicks: 0};
    phase.phase = 'active'; phase.triggeredAt = game.tick; phase.bossId = boss.id;
    s.units.push(boss);
    const core = s.bases[1];
    for (const u of s.units) if (u.side === 0 && u.hp > 0 && Math.hypot(u.x - core.x, u.y - core.y) <= ENCOUNTER.pulseRadius) game._damage(u, u.hp, 1);
    s.units = s.units.filter(u => u.hp > 0);
    game._effect(boss.x, boss.y, 'spawn', 1, 1.5, 180);
  }
  if (phase.phase === 'active' && !s.units.some(u => u.id === phase.bossId && u.hp > 0)) {
    phase.phase = 'defeated'; phase.defeatedAt = game.tick;
  }
}

/** The earliest terminal event wins. Later fabricated events cannot reopen it. */
export function colossusTerminal(game) {
  const p = game.state.colossus, failureAt = p.playerFellAt ?? Infinity;
  const completeAt = game.ruleset.id === COLOSSUS_IDS[1] || p.phase === 'armed'
    ? p.coreFellAt ?? Infinity
    : p.phase === 'defeated' && p.coreFellAt !== null ? Math.max(p.coreFellAt, p.defeatedAt) : Infinity;
  const at = Math.min(failureAt, completeAt);
  return at === Infinity ? {outcome: null, at: null}
    : {outcome: failureAt === completeAt ? 'draw' : failureAt < completeAt ? 1 : 0, at};
}

/** Finale victory contract: both the original enemy core and the deployed Engine. */
export const colossusOutcome = game => colossusTerminal(game).outcome;

export function settleColossusOutcome(game) {
  const outcome = colossusOutcome(game);
  if (outcome !== null && game.state.colossus.endedAt === null) game.state.colossus.endedAt = game.tick;
  return outcome;
}

/** Public Volley can kill outside update, including while paused. Settle now. */
export function settleColossusCommand(game) {
  const s = game.state, p = s.colossus;
  if (p.phase === 'active' && !s.units.some(u => u.id === p.bossId && u.hp > 0)) {
    p.phase = 'defeated'; p.defeatedAt = game.tick;
    s.units = s.units.filter(u => u.hp > 0);
  }
  const outcome = settleColossusOutcome(game);
  if (outcome !== null) s.winner = outcome;
}

export function validateColossusState(game, fail) {
  const {state: s, tick, nextId, map, ruleset} = game, p = s.colossus;
  if (map.id !== 'classic' || map.revision !== 1) fail('Colossus requires Classic');
  const names = ['revision', 'motion', 'phase', 'triggeredAt', 'bossId', 'defeatedAt', 'coreFellAt', 'playerFellAt', 'endedAt'];
  if (!p || Object.keys(p).length !== names.length || names.some(k => !Object.hasOwn(p, k))) fail('Invalid Colossus fields');
  if (p.revision !== 2 || !['armed', 'active', 'defeated'].includes(p.phase)) fail('Unknown Colossus phase');
  const nullableTick = value => value === null || (Number.isSafeInteger(value) && value > 0 && value <= tick);
  if (![p.triggeredAt, p.defeatedAt, p.coreFellAt, p.playerFellAt, p.endedAt].every(nullableTick)) fail('Invalid Colossus clock');
  if (Math.abs(s.time - tick * .05) > Math.min(.001, 1e-7 + s.time * 1e-9)) fail('Colossus fixed clock mismatch');
  const bosses = s.units.filter(isColossus);
  if (p.phase === 'armed') {
    if (p.motion !== null || p.triggeredAt !== null || p.bossId !== null || p.defeatedAt !== null || bosses.length) fail('Armed Colossus has deployed');
    if (tick > 0 && s.bases[0].hp > 0 && s.bases[1].hp <= ENCOUNTER.triggerHp) fail('Colossus trigger was skipped');
    if (p.coreFellAt !== null && p.coreFellAt !== p.playerFellAt) fail('Armed Colossus missed an earlier core fall');
  } else {
    if (p.triggeredAt === null || !Number.isSafeInteger(p.bossId) || p.bossId < 1 || p.bossId >= nextId) fail('Missing Colossus deployment');
    const motion = p.motion;
    if (!motion || Object.keys(motion).length !== 2 || !['approachTicks','siegeTicks'].every(k => Object.hasOwn(motion,k) && Number.isSafeInteger(motion[k]) && motion[k] >= 0)) fail('Invalid Colossus movement state');
    const approachSteps = Math.ceil((map.width - 280 - ENCOUNTER.siegeBoundary) / (ENCOUNTER.approachSpeed * .05));
    if (motion.approachTicks > approachSteps || motion.siegeTicks > 0 && motion.approachTicks !== approachSteps) fail('Invalid Colossus movement transition');
    const travelSteps = Math.max(0, (p.defeatedAt ?? tick) - p.triggeredAt - ENCOUNTER.emergeTicks + 1);
    const moved = motion.approachTicks + motion.siegeTicks;
    // A lethal native hit can precede this unit's scheduled step in that tick.
    if (p.phase === 'active' ? moved !== travelSteps : moved > travelSteps || moved < Math.max(0, travelSteps - 1)) fail('Colossus movement clock mismatch');
    if (p.phase === 'active') {
      if (p.defeatedAt !== null || bosses.length !== 1 || bosses[0].id !== p.bossId || bosses[0].hp <= 0) fail('Active Colossus link mismatch');
      const boss = bosses[0];
      if (boss.side !== 1 || boss.level !== 1 || boss.lane !== 1 || boss.y !== 450 || boss.x > map.width - 280 || boss.x < 110 + 55 + COLOSSUS.radius + COLOSSUS.range) fail('Invalid Colossus body');
      // A public Volley may already have damaged the fresh boss between ticks.
      if (tick === p.triggeredAt && (boss.x !== map.width - 280 || boss.cooldown !== 0 || boss.attack !== 0 || boss.hit !== undefined && ![0, .16].includes(boss.hit))) fail('Invalid initial Colossus body');
      if (boss.cooldown > COLOSSUS.attackTime || boss.attack > .22 || (boss.hit || 0) > .16) fail('Invalid Colossus attack timer');
      if (tick < p.triggeredAt + ENCOUNTER.emergeTicks && (Math.abs(boss.cooldown - Math.max(-1, -(tick - p.triggeredAt) * .05)) > 1e-7 || boss.attack !== 0)) fail('Invalid Colossus emergence timer');
      const approachedX = Math.max(ENCOUNTER.siegeBoundary, map.width - 280 - motion.approachTicks * ENCOUNTER.approachSpeed * .05);
      const expectedX = Math.max(110 + 55 + COLOSSUS.radius + COLOSSUS.range, approachedX - motion.siegeTicks * COLOSSUS.speed * .05);
      if (Math.abs(boss.x - expectedX) > 1e-6) fail('Colossus march position does not match its clock');
    } else if (p.defeatedAt === null || p.defeatedAt <= p.triggeredAt || bosses.length || [...s.units, ...s.buildings].some(u => u.id === p.bossId)) fail('Invalid defeated Colossus');
  }
  if ((s.bases[1].hp === 0) !== (p.coreFellAt !== null)) fail('Colossus core history mismatch');
  if ((s.bases[0].hp === 0) !== (p.playerFellAt !== null)) fail('Colossus player-core history mismatch');
  if (p.coreFellAt !== null && p.triggeredAt !== null && p.coreFellAt < p.triggeredAt) fail('Core fell before its Colossus trigger');
  if (s.units.filter(u => u.side === 1 && !isColossus(u)).length > (p.phase === 'armed' ? 69 : 70)) fail('Colossus slot reservation violated');
  const terminal = colossusTerminal(game);
  if (s.winner !== terminal.outcome) fail('Colossus terminal outcome mismatch');
  if ((s.winner === null) !== (p.endedAt === null) || p.endedAt !== null && p.endedAt !== tick) fail('Colossus terminal clock mismatch');
  if (s.winner !== null) {
    if (terminal.at !== p.endedAt || p.playerFellAt !== null && p.playerFellAt !== p.endedAt) fail('Colossus terminal event clock mismatch');
  }
  if (!COLOSSUS_IDS.includes(ruleset.id)) fail('Invalid Colossus ruleset identity');
}
