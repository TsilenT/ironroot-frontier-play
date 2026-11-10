// Current presentation only. Mission identity, unlocks and victory rules stay in campaign.js.
export const CURRENT_RIVER_COMPACT_EPILOGUE = 'From the lantern-lit banks to the borrowed yard, the river towns now share the watch over crossings and signal fires, so the next convoy need not depend on Rowan’s company to reach the far bank.';
export const CURRENT_UNLIT_ROADS_EPILOGUE = 'The watchfires answer across all three roads again. With a passage open through the reed beds, Rowan’s company leaves the uplands for the coast.';
export const CURRENT_SIEGE_COAST_EPILOGUE = 'The quays and coastal roads are secure. Rowan’s company has completed the Siege Coast; later chapters remain ahead.';
const GOALS = {
  'cut-the-bowstrings': 'Destroy both original North Bow and South Bow archery ranges by 10:00, or destroy the enemy citadel. Your citadel must survive; 1 HP is enough.',
  'three-minutes-more': 'Survive until 3:00 with your citadel alive, or destroy the enemy citadel earlier. One HP is enough.',
  'leave-no-road-closed': 'Control all three bridges for 30 cumulative seconds, or destroy the enemy citadel, by 10:00 while yours survives. One HP is enough; earned control time survives interruptions.',
  'the-empty-purse': 'Destroy the enemy citadel by 10:00 while yours survives; 1 HP is enough. Keep mine income or salvage for earlier support. Neither choice nor mine survival is required.',
  'wake-the-reserve': 'Destroy the enemy citadel by 10:00 while yours survives; 1 HP is enough. The North Command Post and its reserve are optional.',
  'the-shared-watch': 'Destroy the enemy citadel by 10:00 while yours survives; 1 HP is enough. A middle watch or advancing support is optional; no tower, road or unit is required.',
  'the-long-screen': 'Destroy the enemy citadel before 10:00 while yours survives. Break central production or buy time for an outer attack; no route is required.',
  'the-hammer-turns': 'Destroy the enemy citadel before 10:00 while yours survives. Meet the paid siege commitment or support another road; no route is required.',
  'salt-in-the-stores': 'Destroy the enemy citadel before 10:00 while yours survives. Mine raids are optional; surviving factories keep spawning.',
  'the-archers-quay': 'Destroy the coastal enemy citadel before 10:00. Your citadel must survive; no workshop or route is required.',
  'through-the-reed-beds': 'Destroy any 2 of the 3 original named positions, or break the enemy citadel before 10:00. Your citadel must survive.',
  'the-road-we-know': 'Choose either visible road and destroy the enemy citadel before 10:00. Keep your own citadel standing.',
  'false-quiet': 'Scout or commit directly: destroy the original Middle Road Fort, or break the enemy citadel before 10:00.',
  'a-river-between-us': 'Destroy the original North Command Post and secure any two crossings for 60 seconds in total, in either order. Or destroy the enemy citadel before 10:00.',
  'lanterns-on-the-water': 'Scout the roads and destroy both charted customs houses, or break the enemy citadel before 10:00.',
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
  if (mission.id === 'a-river-between-us') facts.push('Both goals required; either order', 'North Command Post: original north-road watchtower', 'Your citadel must survive; replacements do not count');
  if (mission.id === 'false-quiet') facts.push('Two possible enemy layouts; scout to identify this attempt', 'Restart and Resume preserve the layout', 'Your citadel must survive; replacements do not count');
  if (mission.id === 'the-shared-watch') facts.push('Shared nearby middle/south ground defense or advancing support', 'Limited reach; one shared firing stream', 'No compulsory tower, target, unit or road', 'Your citadel must survive; 1 HP is enough');
  if (mission.id === 'cut-the-bowstrings') facts.push('Both named original outer archery ranges; replacements do not restore credit', 'Two normal level-1 gryphons already aloft at time zero', 'Ordinary production and paid adaptive enemy; no unit orders', 'No required purchase, unit, protected factory or bridge', '3:00 and 4,500 HP are optional stars; normal 5:00 escalation');
  if (mission.id === 'three-minutes-more') facts.push('Two roads · 3:00 survival or earlier enemy core', 'No required purchase, protected factory or bridge ownership', 'Ordinary paid adaptive enemy · 100 starting gold', 'The stand ends before 5:00 escalation', '4,500 HP and three living level-2+ buildings are optional stars; 1 HP is enough');
  if (mission.id === 'leave-no-road-closed') facts.push('All three crossings, 30 cumulative seconds; enemy citadel is an alternative', 'Ground captures; flyers deny but cannot capture', 'No compulsory purchase, building loss or replacement', 'Normal paid adaptive enemy and 5:00 escalation', '3:00 and 4,500-HP stars optional; 1 HP is enough');
  if (mission.id === 'the-empty-purse') facts.push('Zero starting gold; 12.5 gold/sec while both mines survive', 'Middle L3 mine: 5 gold/sec, or 261 one-time salvage at full health', 'Damage reduces salvage; selling gives up continuing income', 'No required sale, replacement, mine survival or resource threshold', 'Normal paid adaptive enemy and 5:00 escalation', '3:00 and 4,500-HP stars optional; 1 HP is enough');
  if (mission.id === 'wake-the-reserve') facts.push('Fully visible optional North Command Post on the north road', 'Destroy the original post: six-second warning, then one north contingent', '4 warriors + 2 archers; ordinary level 1; enemy cap can delay arrival', 'Paid enemy building and factory production continue; no required reserve kills', 'Normal 5:00 escalation; your citadel must survive; 1 HP is enough', '3:00 and 4,500-HP stars are optional');
  if (mission.id === 'the-long-screen') facts.push('Durable central troops; ordinary paid adaptive enemy', 'Central demolition or temporary containment', 'No compulsory target, unit or road', 'Your citadel must survive; 1 HP is enough');
  if (mission.id === 'the-hammer-turns') facts.push('New paid foundries show the siege commitment', 'All roads visible; no compulsory target or army', 'Emergency defense uses the same treasury', 'Your citadel must survive; 1 HP is enough');
  if (mission.id === 'salt-in-the-stores') facts.push('Three real enemy mines fund later paid works', 'Mine raids optional; direct siege allowed', 'Existing factories keep spawning after mine losses', 'Your citadel must survive; 1 HP is enough');
  if (mission.id === 'the-archers-quay') facts.push('Fully visible central archery production and outer foundries', 'Core only; no required buildings or route', 'Your citadel must survive; 1 HP is enough');
  if (mission.id === 'through-the-reed-beds') facts.push('Any 2 of 3 original positions; the third may stand', 'Enemy citadel is an alternative; 1 HP on yours is enough', 'Replacements do not restore original targets; all roads visible');
  if (hold && hold.seconds !== mission.timeLimit) facts.push(`Hold for ${clock(hold.seconds)}`);
  if (health) facts.push(`Keep at least ${health.amount.toLocaleString('en-US')} citadel HP`);
  if (signals) facts.push(`Keep at least 1 of 2 signals until ${clock(signals.seconds)}`);
  return {
    goal: GOALS[mission.id] || mission.objective,
    facts,
    protection: signals ? 'Keep at least one original signal alive, even if you destroy the enemy citadel. Either signal may fall to enemy attacks; losing the last fails the mission. Signals cannot be salvaged, and replacements do not count. Keeping both earns an optional medal.' : protectedCount ? 'Keep the marked starting buildings alive, even if you destroy the enemy citadel. Losing or salvaging one fails the mission; replacing it does not count.' : '',
  };
}
