// Briefing copy only. Mission identity, unlocks and victory rules stay in campaign.js.
const GOALS = {
  'one-signal-is-enough': 'Keep either original signal standing while the column evacuates, or destroy the enemy citadel with a signal still alive.',
  'shared-crossing': 'Keep any two bridges clear long enough for the supply column to cross, or destroy the enemy citadel.',
  'roadside-watch': 'Build your first army and clear the marked raider barracks from the road.',
  'shield-at-the-fork': 'Push down both roads and destroy the three marked raider buildings.',
  'open-three-roads': 'Choose a force for each road and destroy all five marked enemy buildings.',
  'first-watch': 'Build an army and clear the marked raider barracks from the road.',
  'forked-road': 'Send troops down both roads and destroy both marked raider barracks.',
  emberwatch: 'Destroy the marked barracks and light the first watchfire.',
  'three-roads': 'Break the marked barracks on both outer roads to free the villages.',
  'winter-stores': 'Keep both marked supply mines standing and grow your gold income.',
  'wings-of-ash': 'Destroy both marked gryphon aeries so the army can cross the pass.',
  stonegate: 'Break all three marked watchtowers on the middle road.',
  'long-vigil': 'Hold the line and keep the marked signal sanctum standing.',
  'cold-forge': 'Destroy both marked foundries before their siege line reaches the pass.',
  'black-ledger': 'Destroy all three marked enemy mines to cut the marshal’s supply.',
  'furnace-heart': 'Destroy the marked foundry and sanctum while protecting your citadel.',
  'crown-foothold': 'Build a strong gold income to fund the final push.',
  'last-light': 'Survive the counterattack and keep both marked watchtowers standing.',
  ironroot: 'Break the marshal’s citadel and keep your own standing.',
  'open-horizon': 'Break both marked middle-road toll towers and keep your marked starting barracks standing.',
  'river-charter': 'Grow your gold income and keep both marked starting watchtowers standing.',
  'far-beacon': 'Destroy both marked outer-road mines and hold the road for the beacons.',
  'common-ground': 'Destroy the marked northern foundry and southern sanctum. Keep your marked starting mine and southern barracks standing.',
};
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;


// This presentation is deliberately bounded to the two-signal scenario. The
// campaign evaluator remains authoritative for victory and original identity.
export function signalProtectionRules(mission) {
  if (mission?.id !== 'one-signal-is-enough') return null;
  const protection = mission.objectives?.find(o => o.type === 'protect');
  const hold = mission.objectives?.find(o => o.type === 'survive');
  if (protection?.minimumSurvivors !== 1 || protection.targets?.length !== 2 ||
      !Number.isFinite(hold?.seconds) || hold.seconds <= 0) return null;
  return Object.freeze({ total: 2, minimum: 1, seconds: hold.seconds });
}

/** Pure presentation from the existing monitor, never a saved survivor count.
 * Messages describe current state; the app owns one-time/paused delivery and
 * must not announce permittedLossMessage every frame. Loss details retain the
 * monitor's separate observed-transition versus already-missing provenance.
 */
export function signalProtectionSummary(mission, snapshot, battleTime = 0) {
  const rules = signalProtectionRules(mission);
  if (!rules || !Array.isArray(snapshot) || snapshot.length !== rules.total) return null;
  const living = snapshot.filter(target => target.status !== 'lost' && target.hp > 0 && !target.loss);
  const lost = snapshot.filter(target => target.status === 'lost');
  const last = living.length === 1 ? living[0] : null;
  const elapsed = Math.min(rules.seconds, Math.max(0, Number.isFinite(battleTime) ? battleTime : 0));
  const missing = lost[0];
  const lossPhrase = missing?.loss?.scope === 'already-missing'
    ? `${missing.label} was already missing when this view began; its loss time is unknown.`
    : missing ? `${missing.label} lost.` : '';
  return Object.freeze({
    ...rules, alive: living.length,
    hudLabel: `${living.length}/2 signals alive; need 1`,
    evacuationLabel: `Evacuation ${clock(Math.floor(elapsed))} / ${clock(rules.seconds)}`,
    evacuationProgress: elapsed / rules.seconds,
    lastSignalId: last?.originalId ?? null,
    permittedLossMessage: last && missing ? `${lossPhrase} ${last.label} remains; the evacuation can continue.` : '',
    criticalMessage: last?.status === 'critical'
      ? `Last signal at critical health: ${last.label} (${last.percent}% HP). Losing it fails the mission.` : '',
    selectionDescription: 'Keep at least one original signal standing. You may let either signal fall to enemy attacks, but signals cannot be salvaged and replacements do not count.',
  });
}

export function missionBriefing(mission) {
  const income = mission.objectives.find(o => o.type === 'income');
  const hold = mission.objectives.find(o => o.type === 'survive');
  const health = mission.objectives.find(o => o.type === 'health');
  const protectedCount = mission.objectives.filter(o => o.type === 'protect')
    .reduce((sum, objective) => sum + objective.targets.length, 0);
  const control = mission.objectives.find(o => o.type === 'control');
  const signals = signalProtectionRules(mission);
  const facts = [];
  if (income) facts.push(`${income.amount} gold/sec at ${clock(mission.timeLimit)}`);
  else if (hold?.seconds === mission.timeLimit) facts.push(`Hold for ${clock(hold.seconds)}`);
  else facts.push(`${clock(mission.timeLimit)} time limit`);
  if (control) facts.push(`Hold any ${control.bridges} bridges for ${control.seconds} seconds in total`, 'Contested progress pauses; secured time is kept', 'No bridge gold bonus');
  if (hold && hold.seconds !== mission.timeLimit) facts.push(`Hold for ${clock(hold.seconds)}`);
  if (health) facts.push(`Keep at least ${health.amount.toLocaleString('en-US')} citadel HP`);
  if (signals) facts.push(`Keep at least 1 of 2 signals until ${clock(signals.seconds)}`);
  return {
    goal: GOALS[mission.id] || mission.objective,
    facts,
    protection: signals ? 'Keep at least one original signal alive, even if you destroy the enemy citadel. Either signal may fall to enemy attacks; losing the last fails the mission. Signals cannot be salvaged, and replacements do not count. Keeping both earns an optional medal.' : protectedCount ? 'Keep the marked starting buildings alive, even if you destroy the enemy citadel. Losing or salvaging one fails the mission; replacing it does not count.' : '',
  };
}
