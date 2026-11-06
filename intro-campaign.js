import { BUILDINGS } from './engine.js';

/** Optional opening battles. Existing campaign IDs and their records stay separate. */
export const INTRO_CHAPTER = {
  id: 'first-roads', number: 0, name: 'The First Roads', subtitle: 'Learn as you build', theme: 'woodland',
  description: 'Start with one road, then defend a second. These short battles use the same buildings, gold and controls as the rest of the campaign.',
  epilogue: 'The roads are clear. Rowan is waiting at Emberwatch.', optional: true,
};

const destroy = (targets) => ({ id: 'roadblocks', type: 'destroy', label: targets.length === 1 ? 'Destroy the marked barracks' : 'Destroy both marked barracks', targets });
const target = (lane) => ({ type: 'barracks', x: 2370, lane });
const identity = {
  chapterId: INTRO_CHAPTER.id, optional: true, scenarioRevision: 1,
  rulesetId: 'frontier-legacy', rulesetRevision: 1, mapRevision: 1,
  difficulty: 'easy', ai: false, startingHealth: 6000, enemyGold: 0,
};

export const INTRO_MISSIONS = [
  {
    ...identity, id: 'first-watch', number: 1, name: 'First Watch', subtitle: 'Build your first army',
    mapId: 'intro-one-road', seed: 1001, timeLimit: 180, startingGold: 420, prerequisites: [],
    description: 'A raider barracks blocks the road to Emberwatch. Your camp is empty. Build an army and clear the way.',
    dialogue: { speaker: 'Captain Rowan', text: 'Put a barracks on the road. The warriors will take it from there.' },
    victoryText: 'The raiders leave the road. Ahead, the path splits around the hills.',
    objective: 'Destroy the marked barracks within 3:00, or destroy the enemy citadel.',
    hint: 'Start with a barracks. An archery range behind it adds ranged support. Troops march and fight on their own.',
    playerBuildings: [], enemyBuildings: [['barracks', 2370, 0]],
    objectives: [destroy([target(0)])],
    medals: [
      { id: 'first-barracks', type: 'building-type', buildingType: 'barracks', amount: 1, label: 'Finish with a barracks standing' },
      { id: 'ranged-support', type: 'building-type', buildingType: 'archery', amount: 1, label: 'Finish with an archery range standing' },
    ],
    briefing: [
      'One road. 420 gold. No starting buildings; every choice has its normal cost.',
      'The enemy has one level-1 barracks and cannot build, upgrade or use Rally.',
      'A win opens the second lesson. The two building stars are optional; replay any time.',
    ],
    reward: 'Opens Forked Road. You can enter the main campaign at any time.',
  },
  {
    ...identity, id: 'forked-road', number: 2, name: 'Forked Road', subtitle: 'Watch both roads',
    mapId: 'intro-two-road', seed: 1003, timeLimit: 210, startingGold: 610, prerequisites: ['first-watch'],
    description: 'Two raider camps control the fork. Send troops down both roads and leave room for a working mine.',
    dialogue: { speaker: 'Scout Sera', text: 'They have a camp on each road. Check both before you spend.' },
    victoryText: 'Both roads are open. The scouts lead you on to Emberwatch.',
    objective: 'Destroy both marked barracks within 3:30, or destroy the enemy citadel.',
    hint: 'Build troops on both roads first. A mine adds 2.5 gold/sec; a watchtower can hold a road while you build up.',
    playerBuildings: [], enemyBuildings: [['barracks', 2370, 0], ['barracks', 2370, 1]],
    objectives: [destroy([target(0), target(1)])],
    medals: [
      { id: 'both-roads', type: 'production-lanes', lanes: [0, 1], label: 'Finish with a troop-producing building on each road' },
      { id: 'working-mine', type: 'income', amount: 7.5, label: 'Finish with at least 7.5 gold/sec' },
    ],
    briefing: [
      'Two roads. 610 gold. No starting buildings; mines and towers use normal gold costs.',
      'The enemy has one level-1 barracks on each road and cannot build, upgrade or use Rally.',
      'The income star needs a living mine. Winning without one still counts as a win.',
    ],
    reward: 'Ready for Emberwatch. The main campaign keeps the full building roster.',
  },
];

export function isIntroMission(id) {
  return typeof id === 'string' && INTRO_MISSIONS.some(mission => mission.id === id);
}

/** Live, save-stable evidence. Labels deliberately require buildings to survive. */
export function introMedalMet(game, medal) {
  if (medal.type !== 'building-type' && medal.type !== 'production-lanes') return null;
  const living = game.state.buildings.filter(building => building.side === 0 && building.hp > 0);
  const definitions = game.buildings || BUILDINGS;
  if (medal.type === 'building-type')
    return living.filter(building => building.type === medal.buildingType).length >= medal.amount;
  if (medal.type === 'production-lanes')
    return medal.lanes.every(lane => living.some(building => building.lane === lane &&
      Object.hasOwn(definitions, building.type) && definitions[building.type].unit));
  return null;
}
