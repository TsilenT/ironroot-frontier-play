// Briefing copy only. Mission identity, unlocks and victory rules stay in campaign.js.
const GOALS = {
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

export function missionBriefing(mission) {
  const income = mission.objectives.find(o => o.type === 'income');
  const hold = mission.objectives.find(o => o.type === 'survive');
  const health = mission.objectives.find(o => o.type === 'health');
  const protectedCount = mission.objectives.filter(o => o.type === 'protect')
    .reduce((sum, objective) => sum + objective.targets.length, 0);
  const facts = [];
  if (income) facts.push(`${income.amount} gold/sec at ${clock(mission.timeLimit)}`);
  else if (hold?.seconds === mission.timeLimit) facts.push(`Hold for ${clock(hold.seconds)}`);
  else facts.push(`${clock(mission.timeLimit)} time limit`);
  if (hold && hold.seconds !== mission.timeLimit) facts.push(`Hold for ${clock(hold.seconds)}`);
  if (health) facts.push(`Keep at least ${health.amount.toLocaleString('en-US')} citadel HP`);
  return {
    goal: GOALS[mission.id] || mission.objective,
    facts,
    protection: protectedCount ? 'Keep the marked starting buildings alive, even if you destroy the enemy citadel. Losing or salvaging one fails the mission; replacing it does not count.' : '',
  };
}
