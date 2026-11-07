/** New campaign opening. Published v1 scenarios keep their own IDs and rules. */
export const ONBOARDING_CHAPTER = {
  id: 'opening-roads', number: 0, name: 'The Road to Emberwatch',
  subtitle: 'Build the company', theme: 'woodland',
  description: 'Clear one road, defend the fork, then bring the whole company to Emberwatch. New buildings join you after each win.',
  epilogue: 'The company is assembled. Rowan leads the march to Emberwatch.',
};

const target = (type, x, lane) => ({ type, x, lane });
const destroy = (label, targets) => ({ id: 'roadblocks', type: 'destroy', label, targets });
const standing = (id, buildingType, label) => ({ id, type: 'building-type', buildingType, amount: 1, label });
const identity = {
  chapterId: ONBOARDING_CHAPTER.id, scenarioRevision: 1,
  rulesetRevision: 1, mapRevision: 1, difficulty: 'easy', ai: false,
  startingHealth: 6000, enemyGold: 0, playerBuildings: [],
};

export const ONBOARDING_MISSIONS = [
  {
    ...identity, id: 'roadside-watch', number: 1, name: 'Roadside Watch', subtitle: 'Raise the first company',
    mapId: 'intro-one-road', rulesetId: 'frontier-campaign-watch', seed: 2001,
    timeLimit: 180, startingGold: 420, prerequisites: [],
    description: 'One raider camp blocks the road. Your builders have brought plans for a barracks and an archery range.',
    dialogue: { speaker: 'Captain Rowan', text: 'Put a barracks on the road. Build archers behind it if the warriors need help.' },
    victoryText: 'The first road is clear. Wardens and miners meet the company at the fork.',
    objective: 'Destroy the marked barracks within 3:00, or destroy the enemy citadel.',
    hint: 'Choose a building in the build bar, then choose a site. Warriors move and fight on their own. Archers work best behind them.',
    enemyBuildings: [['barracks', 2370, 0]],
    objectives: [destroy('Destroy the raider barracks', [target('barracks', 2370, 0)])],
    medals: [
      standing('first-company', 'barracks', 'Finish with a barracks standing'),
      standing('ranged-support', 'archery', 'Finish with an archery range standing'),
    ],
    briefing: [
      'One road. 420 gold. Build barracks and archery ranges at their normal prices.',
      'Your camp starts empty. The enemy has one level-1 barracks and cannot build, upgrade or use Arrow volley.',
      'Any win opens the fork and adds Warden lodges, gold mines and watchtowers. Stars are optional.',
    ],
    reward: 'Adds Warden lodges, gold mines and watchtowers. Opens Shield at the Fork.',
  },
  {
    ...identity, id: 'shield-at-the-fork', number: 2, name: 'Shield at the Fork', subtitle: 'Give the archers cover',
    mapId: 'intro-two-road', rulesetId: 'frontier-campaign-fork', seed: 2003,
    timeLimit: 210, startingGold: 740, prerequisites: ['roadside-watch'],
    description: 'Raider infantry hold both roads, with archers behind the northern camp. The wardens offer to lead the advance.',
    dialogue: { speaker: 'Captain Rowan', text: 'A Rootwarden can take a beating, but it hits slowly. Put archers behind it and keep an eye on the other road.' },
    victoryText: 'The fork is open. Siege crews, wizards and gryphon riders join the march.',
    objective: 'Destroy all three marked raider buildings within 3:30, or destroy the enemy citadel.',
    hint: 'A Warden lodge in front of an archery range gives the archers a durable screen. Barracks still work. Mines fund more troops; towers can hold a road.',
    enemyBuildings: [['barracks', 2370, 0], ['archery', 2510, 0], ['barracks', 2370, 1]],
    objectives: [destroy('Clear the three raider buildings', [
      target('barracks', 2370, 0), target('archery', 2510, 0), target('barracks', 2370, 1),
    ])],
    medals: [
      standing('warden-company', 'wardenLodge', 'Finish with a Warden lodge standing'),
      { id: 'both-roads', type: 'production-lanes', lanes: [0, 1], label: 'Finish with troop production on both roads' },
    ],
    briefing: [
      'Two roads. 740 gold. Warden lodges, gold mines and watchtowers join your barracks and archery ranges.',
      'The north has a barracks and archery range; the south has a barracks. All are level 1. The enemy cannot build, upgrade or use Arrow volley.',
      'Rootwardens have 800 HP but low damage and cannot attack air. Their lodge costs 210 gold; archery ranges cost 175.',
      'Any win opens the third battle with all eight buildings. You do not need either star to continue.',
    ],
    reward: 'Adds siege foundries, arcane sanctums and gryphon aeries. Opens Open Three Roads with all eight buildings.',
  },
  {
    ...identity, id: 'open-three-roads', number: 3, name: 'Open Three Roads', subtitle: 'Choose a force for each road',
    mapId: 'classic', rulesetId: 'frontier-campaign-open', seed: 2007,
    timeLimit: 240, startingGold: 1100, prerequisites: ['shield-at-the-fork'],
    description: 'Gryphons patrol the north, a tower and wizards guard the middle, and infantry wait to the south. Every part of the company is ready.',
    dialogue: { speaker: 'Scout Sera', text: 'Archers for those northern gryphons. Siege can reach the middle tower. Pick your route, but don’t lose sight of the other roads.' },
    victoryText: 'The way to Emberwatch is open. The full company is yours to command.',
    objective: 'Destroy all five marked enemy buildings within 4:00, or destroy the enemy citadel.',
    hint: 'Rootwardens cannot hit flyers or protect another road. Wizard and siege splash can catch troops behind a screen. Use archers against air and consider siege or gryphons for the middle.',
    enemyBuildings: [
      ['aerie', 2370, 0], ['aerie', 2650, 0], ['watchtower', 2230, 1], ['sanctum', 2510, 1], ['barracks', 2370, 2],
    ],
    objectives: [destroy('Clear the five roadblocks', [
      target('aerie', 2370, 0), target('aerie', 2650, 0), target('watchtower', 2230, 1),
      target('sanctum', 2510, 1), target('barracks', 2370, 2),
    ])],
    medals: [
      { id: 'supplied-company', type: 'income', amount: 7.5, label: 'Finish with at least 7.5 gold/sec' },
      { id: 'covered-citadel', type: 'health', amount: 5000, label: 'Finish with at least 5,000 citadel HP' },
    ],
    briefing: [
      'Three roads. 1,100 gold. All eight buildings are available at their normal prices.',
      'North: two aeries. Middle: a watchtower and sanctum. South: a barracks. All are level 1; the enemy cannot build, upgrade or use Arrow volley.',
      'The full roster is already available in this battle. A win continues to Emberwatch; it does not need three stars.',
      'Destroying the enemy citadel counts even if some marked buildings survive. A risky concentrated attack is allowed.',
    ],
    reward: 'Continue to Emberwatch with the full company. Replay any opening battle with your unlocked buildings.',
  },
];

export function isOnboardingMission(id) {
  return typeof id === 'string' && ONBOARDING_MISSIONS.some(mission => mission.id === id);
}
