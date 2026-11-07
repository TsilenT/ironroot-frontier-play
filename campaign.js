import {Game, BUILDINGS, MAPS, getRuleset} from './engine.js';
import {CAMPAIGN_RULESET_IDS, deepFreeze} from './rulesets.js';
import {ONBOARDING_CHAPTER, ONBOARDING_MISSIONS, isOnboardingMission} from './campaign-onboarding.js';
export {ONBOARDING_CHAPTER, ONBOARDING_MISSIONS, isOnboardingMission} from './campaign-onboarding.js';
import {INTRO_CHAPTER, INTRO_MISSIONS, introMedalMet} from './intro-campaign.js';
export {INTRO_CHAPTER, INTRO_MISSIONS, isIntroMission} from './intro-campaign.js';

/** Campaign rules sit above the ordinary simulation, like field-trial objectives. */
export const CAMPAIGN_VERSION = 1;
export const CAMPAIGN_STORAGE_KEY = 'ironroot.campaign.v1';
export const CAMPAIGN_CHAPTERS = [
  {id:'embers',number:1,name:'Embers of the Vale',subtitle:'Rally the valley villages',theme:'woodland',description:'Marshal Vey has sealed the northern road. Captain Rowan gathers the scattered villages before winter closes the valley.',epilogue:'The granaries are full and the roads are open. For the first time since the invasion, the valley answers the same signal fire.'},
  {id:'highpass',number:2,name:'The High Pass',subtitle:'Carry the signal over the mountains',theme:'highland',description:'Scout Sera brings word of an army beyond Stonegate. Keep the signal stations alive and win a passage through the highlands.',epilogue:'Stonegate opens. Beyond the pass, the smoke of a hundred furnaces darkens the sky.'},
  {id:'furnace',number:3,name:'The Furnace March',subtitle:'Cut the marshal’s reinforcements',theme:'ashlands',description:'Vey’s foundries keep his army supplied. Destroy them and cut his supply lines before the army reaches the valley.',epilogue:'The furnaces fall silent. Vey retreats to the Crownworks, taking the last of his host with him.'},
  {id:'crownworks',number:4,name:'The Last Crown',subtitle:'End the war at its source',theme:'citadel',description:'The Crownworks command all three roads. Secure a foothold, hold against the counterattack, and break the marshal’s final citadel.',epilogue:'The iron crown is lowered. Rowan opens all three roads, and the villages take turns keeping watch.'},
  {id:'frontier',number:5,name:'The Open Frontier',subtitle:'Reopen the roads and river crossings',theme:'woodland',description:'Toll forts still block the frontier after the crown’s fall. Rowan, Sera and Iona set out to reopen the long road and river crossings so the settlements can trade again.',epilogue:'The settlements share the bridges under the river charter. The distant beacons answer, and each village takes its turn on watch.'},
];

const target=(type,x,lane)=>({type,x,lane});
const destroy=(id,label,targets)=>({id,type:'destroy',label,targets});
const survive=(seconds)=>({id:'hold',type:'survive',label:`Hold for ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,seconds});
const economy=(amount)=>({id:'income',type:'income',label:`Reach ${amount} gold/sec at the deadline`,amount});
const protect=(label,targets)=>({id:'protect',type:'protect',label,targets});
const health=(amount)=>({id:'citadel',type:'health',label:`Finish with at least ${amount.toLocaleString('en-US')} citadel HP`,amount});
const swift=(seconds)=>({id:'swift',type:'time',label:`Win in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} or less`,seconds});
const intact=(amount)=>({id:'intact',type:'health',label:`Keep at least ${amount.toLocaleString('en-US')} citadel HP`,amount});
const wealthy=(amount)=>({id:'wealth',type:'income',label:`Finish with ${amount} gold/sec`,amount});
const veterans=(amount)=>({id:'veterans',type:'upgrades',label:`Finish with ${amount} living level-2+ buildings`,amount});

export const CAMPAIGN_MISSIONS = [
  {
    id:'emberwatch',chapterId:'embers',number:1,name:'Emberwatch',subtitle:'Light the first watchfire',
    description:'The last village bell is still ringing. Rowan must drive a raiding company from the crossing before reinforcements arrive.',
    dialogue:{speaker:'Captain Rowan',text:'Build a barracks near the crossing. We need warriors there before the next raid.'},
    victoryText:'The crossing is ours. Families begin to leave their hiding places, following the light of Emberwatch.',
    objective:'Destroy the marked enemy barracks within 3:00. Destroying the enemy citadel also wins.',
    hint:'Put warriors in front and ranged support behind. Keep your troop buildings alive so they can send reinforcements.',
    difficulty:'easy',seed:1101,timeLimit:180,startingGold:460,startingHealth:6000,prerequisites:[],
    playerBuildings:[['barracks',690,1]],enemyBuildings:[['barracks',2230,1],['archery',2650,1]],
    objectives:[destroy('raiders','Destroy the raider barracks',[target('barracks',2230,1)])],medals:[swift(100),intact(5400)],
    briefing:['460 starting gold; citadel starts at 6,000 HP','Your middle-lane barracks is already built','Enemy has a fixed barracks and archery range; no new buildings'],
  },
  {
    id:'three-roads',chapterId:'embers',number:2,name:'Three Roads',subtitle:'Choose where to answer',
    description:'The raiders divide around the village. Clear both outer roads so the valley can send food to Emberwatch.',
    dialogue:{speaker:'Scout Sera',text:'They’re coming around both sides of the village. Watch the north and south roads.'},
    victoryText:'Both roadblocks are gone. Sera’s scouts carry the news to every farm between the ridges.',
    objective:'Destroy both marked outer-lane barracks within 3:30, or destroy the enemy citadel.',
    hint:'Split your production between the north and south. A tower can protect the middle while your armies push outward.',
    difficulty:'normal',seed:1203,timeLimit:210,startingGold:610,startingHealth:5200,prerequisites:['emberwatch'],
    playerBuildings:[['barracks',690,1]],enemyBuildings:[['barracks',2230,0],['barracks',2230,2],['archery',2510,1]],
    objectives:[destroy('roads','Clear both roadblocks',[target('barracks',2230,0),target('barracks',2230,2)])],medals:[swift(150),intact(4000)],
    briefing:['610 starting gold; citadel starts at 5,200 HP','Enemy barracks occupy both outer lanes; archers occupy the middle','Fixed enemy formation; defend and attack across three lanes'],
  },
  {
    id:'winter-stores',chapterId:'embers',number:3,name:'Winter Stores',subtitle:'Save what the valley needs',
    description:'The first snow is days away. Two working mines can fund the valley’s relief, but Vey’s outriders are already on the road.',
    dialogue:{speaker:'Quartermaster Iona',text:'The relief wagons need an escort. Keep those mines working so we can pay for one.'},
    victoryText:'The relief wagons leave under guard. Iona has enough coin and grain to bring the valley through winter.',
    objective:'Keep both marked starting mines alive and have 15 gold/sec at 2:30. Destroying the enemy citadel wins early only if both mines survive.',
    hint:'Protect the outer lanes, add a third mine, and upgrade two mines. Never salvage a protected starting mine.',
    difficulty:'normal',seed:1307,timeLimit:150,startingGold:520,startingHealth:3800,prerequisites:['three-roads'],
    playerBuildings:[['barracks',690,1],['mint',410,0],['mint',410,2]],enemyBuildings:[['barracks',2370,0],['barracks',2370,2],['archery',2650,1]],
    objectives:[economy(15),protect('Keep both supply mines alive',[target('mint',410,0),target('mint',410,2)])],medals:[intact(3000),wealthy(17.5)],
    briefing:['520 starting gold; citadel starts at 3,800 HP','Two protected mines already provide 10 gold/sec total income','Income is checked at 2:30; losing or salvaging either marked mine fails immediately'],
  },
  {
    id:'wings-of-ash',chapterId:'highpass',number:4,name:'Wings of Ash',subtitle:'Take back the open sky',
    description:'Veteran gryphon riders hunt anyone crossing the high pass. Their two aeries must fall before the valley’s army can climb.',
    dialogue:{speaker:'Scout Sera',text:'Gryphons over both roads. Get archers up here before we move through the pass.'},
    victoryText:'The aeries fall. Sera signals the army to enter the pass.',
    objective:'Destroy both marked level-3 aeries within 3:30, or destroy the enemy citadel.',
    hint:'Archers can answer flyers in both outer lanes. Wizards and siege engines cannot target them.',
    difficulty:'normal',seed:2101,timeLimit:210,startingGold:550,startingHealth:4200,prerequisites:['winter-stores'],
    playerBuildings:[['barracks',690,0]],enemyBuildings:[['aerie',1950,0,3],['aerie',2230,2,3]],
    objectives:[destroy('aeries','Destroy both veteran aeries',[target('aerie',1950,0),target('aerie',2230,2)])],medals:[swift(120),intact(3300)],
    briefing:['550 starting gold; citadel starts at 4,200 HP','Both enemy aeries begin at level 3','Fixed enemy formation; the north and south lanes are under air attack'],
  },
  {
    id:'stonegate',chapterId:'highpass',number:5,name:'Stonegate',subtitle:'Find the seam in the wall',
    description:'Three towers guard Stonegate’s middle road. Bram needs siege engines and enough cover to bring them into range.',
    dialogue:{speaker:'Engineer Bram',text:'My engines can reach those towers. Keep their infantry off us while we work.'},
    victoryText:'Bram’s engines break through the gate. The garrison retreats, leaving the road open.',
    objective:'Destroy all three marked level-2 watchtowers within 4:00, or destroy the enemy citadel.',
    hint:'Siege engines outrange towers and deal triple structure damage. Warriors keep enemy infantry off the engines.',
    difficulty:'normal',seed:2203,timeLimit:240,startingGold:600,startingHealth:6000,prerequisites:['winter-stores'],
    playerBuildings:[['barracks',690,1]],enemyBuildings:[['watchtower',1950,1,2],['watchtower',2090,1,2],['watchtower',2230,1,2],['barracks',2510,1]],
    objectives:[destroy('gate','Break the three gate towers',[target('watchtower',1950,1),target('watchtower',2090,1),target('watchtower',2230,1)])],medals:[swift(135),veterans(2)],
    briefing:['600 starting gold; citadel starts at 6,000 HP','Three level-2 towers defend the middle lane, with infantry behind','Fixed enemy formation; all other enemy buildings start at level 1'],
  },
  {
    id:'long-vigil',chapterId:'highpass',number:6,name:'The Long Vigil',subtitle:'Keep the signal burning',
    description:'The army is through the pass, but the rear guard is trapped at a signal station. Keep its sanctum alive until the last company arrives.',
    dialogue:{speaker:'Captain Rowan',text:'They are watching for that light. If it goes out, the army comes back for us.'},
    victoryText:'The final company clears the pass. The signal never falters, and no one has to turn back.',
    objective:'Survive 2:30 while keeping the marked starting sanctum alive. An early enemy-citadel victory still requires the sanctum to survive.',
    hint:'The signal station is in the middle lane. Screen it with towers and troops, and answer the northern flyers with archers.',
    difficulty:'hard',seed:2309,timeLimit:150,startingGold:730,startingHealth:2600,prerequisites:['wings-of-ash','stonegate'],
    playerBuildings:[['barracks',690,1],['sanctum',970,1,2]],enemyBuildings:[['barracks',2230,0],['barracks',2230,1],['barracks',2230,2],['archery',2370,1],['aerie',2370,0],['foundry',2650,1]],
    objectives:[survive(150),protect('Keep the signal sanctum alive',[target('sanctum',970,1)])],medals:[intact(1800),veterans(3)],
    briefing:['730 starting gold; citadel starts at 2,600 HP','A level-2 starting sanctum at the middle front is the protected signal station','Fixed mixed-arms attack on all lanes; losing or salvaging the station fails immediately'],
  },
  {
    id:'cold-forge',chapterId:'furnace',number:7,name:'The Cold Forge',subtitle:'Silence the siege line',
    description:'Vey’s engines are already rolling toward the pass. Destroy the two forward foundries before their crews find the range.',
    dialogue:{speaker:'Engineer Bram',text:'Those foundries are sending engines toward the pass. Hit them before they get their infantry into place.'},
    victoryText:'The forward foundries are cold. Bram turns their abandoned tools toward repairing the road.',
    objective:'Destroy both marked level-2 foundries within 4:00, or destroy the enemy citadel.',
    hint:'Gryphons avoid siege fire, but enemy archers can shoot them down. Mix an air raid with ground pressure or overwhelm one lane first.',
    difficulty:'normal',seed:3101,timeLimit:240,startingGold:710,startingHealth:4800,prerequisites:['long-vigil'],
    playerBuildings:[['barracks',690,1],['archery',550,1]],enemyBuildings:[['foundry',2090,0,2],['foundry',2090,2,2],['barracks',2370,0],['barracks',2370,2],['archery',2510,1]],
    objectives:[destroy('forges','Destroy both forward foundries',[target('foundry',2090,0),target('foundry',2090,2)])],medals:[swift(150),intact(3600)],
    briefing:['710 starting gold; citadel starts at 4,800 HP','Two level-2 enemy foundries occupy the outer lanes','Fixed enemy formation; your middle lane begins with warriors and archers'],
  },
  {
    id:'black-ledger',chapterId:'furnace',number:8,name:'The Black Ledger',subtitle:'Cut the marshal’s supply',
    description:'Iona has found the accounts that feed Vey’s army. Three protected mines fund an enemy commander who rebuilds and adapts.',
    dialogue:{speaker:'Quartermaster Iona',text:'Those three mines pay for Vey’s reinforcements. Hit them to slow his reinforcements.'},
    victoryText:'The mines fall. Vey’s quartermasters can no longer afford the reinforcements he needs.',
    objective:'Destroy all three marked enemy mines within 4:30, or destroy the enemy citadel. The enemy can build and upgrade throughout the mission.',
    hint:'Attack with a screened siege force and expand your own income. The enemy reacts to your army, so check every lane before spending.',
    difficulty:'normal',seed:3203,timeLimit:270,startingGold:900,startingHealth:6000,enemyGold:80,ai:true,prerequisites:['long-vigil'],
    playerBuildings:[['barracks',970,1,2],['archery',830,1],['mint',410,0]],enemyBuildings:[['mint',2790,0],['mint',2790,1],['mint',2790,2],['barracks',2370,1],['watchtower',2510,1]],
    objectives:[destroy('ledger','Destroy the three supply mines',[target('mint',2790,0),target('mint',2790,1),target('mint',2790,2)])],medals:[swift(210),wealthy(15)],
    briefing:['900 starting gold; citadel starts at 6,000 HP','Your middle barracks starts at level 2; one mine is already working','Adaptive enemy starts with 80 gold and three mines, then builds, upgrades and strikes normally'],
  },
  {
    id:'furnace-heart',chapterId:'furnace',number:9,name:'Heart of the Furnace',subtitle:'Make the march count',
    description:'The marshal gathers his surviving regiments around a single strongpoint. Break its siege works while keeping a fighting force for the road ahead.',
    dialogue:{speaker:'Captain Rowan',text:'Take out the siege works. Keep our troops covered on the way in.'},
    victoryText:'The last great foundry falls. Across the march, soldiers abandon their posts and follow the roads home.',
    objective:'Destroy the marked foundry and sanctum within 4:30 while keeping at least 2,000 citadel HP. An enemy-citadel victory also requires 2,000 HP.',
    hint:'Build income early behind a solid front, then combine siege and wizard support. Do not leave your side lanes uncovered.',
    difficulty:'normal',seed:3307,timeLimit:270,startingGold:1000,startingHealth:5200,prerequisites:['cold-forge','black-ledger'],
    playerBuildings:[['barracks',970,1,2],['archery',830,1],['mint',410,0]],enemyBuildings:[['foundry',2510,1,2],['sanctum',2650,1,2],['barracks',2230,1],['archery',2370,1],['barracks',2510,0],['barracks',2510,2]],
    objectives:[destroy('heart','Destroy the two central works',[target('foundry',2510,1),target('sanctum',2650,1)]),health(2000)],medals:[swift(210),intact(4200)],
    briefing:['1,000 starting gold; citadel starts at 5,200 HP and must stay at 2,000+','Your middle barracks and both marked enemy works start at level 2','Fixed fortified enemy formation covers all three lanes; no new enemy buildings'],
  },
  {
    id:'crown-foothold',chapterId:'crownworks',number:10,name:'A Foothold in Iron',subtitle:'Build what the final push needs',
    description:'The Crownworks are in sight. Iona needs a self-sustaining camp before Rowan can risk an assault on the inner walls.',
    dialogue:{speaker:'Quartermaster Iona',text:'We’ll need food and reinforcements for the siege. Get the mines working before Rowan attacks.'},
    victoryText:'The camp holds. Every regiment receives its rations, and the siege crews prepare for the final road.',
    objective:'Have at least 17.5 gold/sec at 3:00 with your citadel alive. Destroying the enemy citadel wins early.',
    hint:'Three mines with four total upgrades reach 17.5 gold/sec. Start with defense, then improve the mines before the enemy pressure peaks.',
    difficulty:'normal',seed:4101,timeLimit:180,startingGold:1050,startingHealth:4200,enemyGold:0,ai:true,prerequisites:['furnace-heart'],
    playerBuildings:[['barracks',970,1,2],['watchtower',1110,0],['watchtower',1110,2],['mint',410,0]],enemyBuildings:[['barracks',2230,0],['barracks',2230,1],['barracks',2230,2],['archery',2510,1]],
    objectives:[economy(17.5)],medals:[intact(3300),wealthy(20)],
    briefing:['1,050 starting gold; citadel starts at 4,200 HP','Level-2 middle barracks, two outer towers, and one mine already built','Adaptive enemy starts with 0 gold; income is checked at 3:00'],
  },
  {
    id:'last-light',chapterId:'crownworks',number:11,name:'The Last Light',subtitle:'Weather the counterattack',
    description:'Vey sends his reserve against the signal stations. If the lights fall, the army will lose its route through the smoke.',
    dialogue:{speaker:'Scout Sera',text:'I have kept a light for every company on this road. Keep these two for me.'},
    victoryText:'Both lights are still burning. Vey has no reserve left, and the army knows exactly where to go.',
    objective:'Survive 3:00 while keeping both marked starting watchtowers alive. An early enemy-citadel victory still requires both towers.',
    hint:'Upgrade the protected towers, put troops ahead of them, and counter enemy siege before it gets a clean shot. Salvaging either tower fails.',
    difficulty:'normal',seed:4201,timeLimit:180,startingGold:1100,startingHealth:3200,enemyGold:0,ai:true,prerequisites:['furnace-heart'],
    playerBuildings:[['watchtower',970,0,2],['watchtower',970,2,2],['barracks',830,1],['archery',690,1]],enemyBuildings:[['barracks',2230,0],['barracks',2230,1],['barracks',2230,2],['foundry',2510,0],['aerie',2510,2]],
    objectives:[survive(180),protect('Keep both signal watchtowers alive',[target('watchtower',970,0),target('watchtower',970,2)])],medals:[intact(2500),veterans(6)],
    briefing:['1,100 starting gold; citadel starts at 3,200 HP','Both protected signal watchtowers start at level 2','Adaptive enemy starts with 0 gold, northern siege and southern flyers'],
  },
  {
    id:'ironroot',chapterId:'crownworks',number:12,name:'Ironroot',subtitle:'Open the three roads',
    description:'Vey has gathered his last army at the Crownworks. Break through and destroy his citadel.',
    dialogue:{speaker:'Captain Rowan',text:'Vey is behind those walls. Once his citadel falls, we can open the roads for good.'},
    victoryText:'The Crownworks fall. The war is over, and the frontier belongs to the people who kept its watchfires burning.',
    objective:'Destroy the enemy citadel within 5:00. The marshal builds, upgrades and uses arrow volleys. Your citadel must survive.',
    hint:'Use the opening treasury to establish income and a balanced main push. Siege breaks structures, archers answer air, and warriors keep both alive.',
    difficulty:'hard',seed:4303,timeLimit:300,startingGold:1400,startingHealth:6000,enemyGold:120,ai:true,prerequisites:['crown-foothold','last-light'],
    playerBuildings:[['barracks',970,1,2],['archery',830,1,2],['mint',410,0],['watchtower',1110,0],['watchtower',1110,2]],enemyBuildings:[['watchtower',1950,1,2],['barracks',2230,1,2],['archery',2370,1,2],['barracks',2370,0],['barracks',2370,2],['aerie',2650,0],['sanctum',2650,2],['mint',2930,1]],
    objectives:[{id:'crown',type:'citadel',label:'Destroy the enemy citadel'}],medals:[swift(240),intact(4000)],
    briefing:['1,400 starting gold; both citadels start at 6,000 HP','Your middle barracks and archery start at level 2, with a mine and outer towers','Hard adaptive enemy starts with 120 gold; middle tower, barracks and archery are level 2'],
  },
  {
    id:'open-horizon',chapterId:'frontier',number:13,mapId:'long-march',name:'Open Horizon',subtitle:'Carry the peace beyond the valley',
    description:'Beyond the Crownworks, abandoned toll towers still close the long road. The relief column has established a field barracks, but holdout gryphons circle the outer tracks.',
    dialogue:{speaker:'Captain Rowan',text:'The war is over, but the relief wagons still can’t get through. Clear those toll towers.'},
    victoryText:'The toll towers fall and the relief column takes the long road. Sera turns toward the beacons while Iona follows the river.',
    objective:'Destroy both marked middle-lane toll towers within 4:00 while keeping the marked starting barracks alive. An enemy-citadel victory still requires the barracks.',
    hint:'Your starting mine already brings income to 7.5 gold/sec. Place a forward middle watchtower and archers ahead of the marked barracks before buying more mines. Once that screen holds the gryphons, send siege toward the toll towers and cover the outer lanes with archers.',
    difficulty:'normal',seed:5101,timeLimit:240,startingGold:1100,startingHealth:5200,prerequisites:['ironroot'],
    playerBuildings:[['barracks',970,1,2],['archery',830,1],['mint',410,1]],
    enemyBuildings:[['watchtower',2750,1,3],['watchtower',2890,1,3],['barracks',3170,1,2],['aerie',3310,1,3],['aerie',3450,1,3],['aerie',3030,0,3],['aerie',3030,2,3]],
    objectives:[destroy('tolls','Break both toll towers',[target('watchtower',2750,1),target('watchtower',2890,1)]),protect('Keep the relief barracks alive',[target('barracks',970,1)])],medals:[swift(200),intact(4200)],
    briefing:['Losing or salvaging the marked relief barracks fails immediately; the enemy citadel is an alternative victory only while it survives'],
  },
  {
    id:'river-charter',chapterId:'frontier',number:14,mapId:'twin-span',name:'The River Charter',subtitle:'Fund the river settlements',
    description:'Two bridges serve every settlement along the river. Iona must keep their watchposts standing and fund a shared granary without filling every site with soldiers.',
    dialogue:{speaker:'Quartermaster Iona',text:'Keep both bridge watchposts standing. We need room for mines as well as troops.'},
    victoryText:'The watchposts hold and the granary is funded. Both banks sign the river charter and agree to share the crossings.',
    objective:'Keep both marked starting watchtowers alive and reach 17.5 gold/sec at 3:30. An early enemy-citadel victory still requires both towers.',
    hint:'Three mines fit on either bank, but leave space for counters. Northern siege threatens the watchpost; southern gryphons demand archers. Upgrade instead of filling every site.',
    difficulty:'normal',seed:5203,timeLimit:210,startingGold:1100,startingHealth:3800,prerequisites:['open-horizon'],
    playerBuildings:[['watchtower',970,0,3],['watchtower',970,1,3],['barracks',830,0],['archery',830,1],['mint',410,0]],
    enemyBuildings:[['foundry',2230,0,3],['foundry',2370,0,2],['barracks',2510,0,2],['aerie',2230,1,3],['aerie',2370,1,3],['aerie',2510,1,3]],
    objectives:[economy(17.5),protect('Keep both bridge watchposts alive',[target('watchtower',970,0),target('watchtower',970,1)])],medals:[wealthy(20),veterans(6)],
    briefing:['Income is checked at 3:30; losing or salvaging either marked watchpost fails immediately; an enemy-citadel victory can finish early'],
  },
  {
    id:'far-beacon',chapterId:'frontier',number:15,mapId:'long-march',name:'The Far Beacons',subtitle:'Reach the people beyond the road',
    description:'Sera finds the distant signal route occupied by companies still drawing pay from the old crown. Cut the two outer pay stations and hold the road while the settlements answer.',
    dialogue:{speaker:'Scout Sera',text:'The old crown still pays the companies out there. Cut off their pay stations and hold until the beacons answer.'},
    victoryText:'The pay stations close and both beacons answer. The far settlements send delegates to meet Iona at the bridges.',
    objective:'Destroy both marked outer-lane mines and hold for 3:10, within 4:40, with at least 2,000 citadel HP. An enemy-citadel victory can end the hold early but still requires 2,000 HP.',
    hint:'Attack both outer supply lines with ranged support against flyers. Defend the middle while your troops make the long journey. Build income before spending all your gold on the attack.',
    difficulty:'normal',seed:5309,timeLimit:280,startingGold:1350,startingHealth:5400,prerequisites:['open-horizon'],
    playerBuildings:[['barracks',970,0,2],['archery',830,0],['barracks',970,2,2],['archery',830,2],['mint',410,1]],
    enemyBuildings:[['mint',3590,0],['mint',3590,2],['aerie',3030,0,3],['aerie',3030,2,3],['aerie',3310,0,3],['aerie',3310,2,3],['barracks',3170,0,2],['barracks',3170,2,2],['foundry',2750,1,3],['sanctum',2890,1,3],['sanctum',3030,1,3]],
    objectives:[destroy('paystations','Close both outer pay stations',[target('mint',3590,0),target('mint',3590,2)]),survive(190),health(2000)],medals:[swift(245),wealthy(15)],
    briefing:['Both pay stations must fall and the road must hold until 3:10, unless the enemy citadel falls first; falling below 2,000 citadel HP fails immediately'],
  },
  {
    id:'common-ground',chapterId:'frontier',number:16,mapId:'twin-span',name:'Common Ground',subtitle:'Keep the bridges open for everyone',
    description:'The last toll commander attacks the meeting of the river and beacon settlements. Their shared camp must survive while Rowan breaks the two works that supply the attack.',
    dialogue:{speaker:'Captain Rowan',text:'Hold the camp. Iona and Sera are bringing the delegates here, and they need both bridges open.'},
    victoryText:'The last toll works fall. The river and beacon delegates meet at the camp to agree on how to keep the roads open.',
    objective:'Destroy the marked northern foundry and southern sanctum within 5:00 while keeping the marked starting mine and southern barracks alive. An enemy-citadel victory still requires both protected buildings.',
    hint:'The commander pays for every reinforcement and reacts to your army. Keep ground troops ahead of the northern mine and archers against the southern flyers. Upgrade your army before using all sixteen sites.',
    difficulty:'hard',seed:5407,timeLimit:300,startingGold:1500,startingHealth:6000,enemyGold:80,ai:true,prerequisites:['river-charter','far-beacon'],
    playerBuildings:[['mint',410,0],['barracks',970,0,2],['archery',830,0],['barracks',690,1,2],['archery',830,1,2]],
    enemyBuildings:[['foundry',2650,0,2],['sanctum',2650,1,2],['barracks',2230,0,2],['barracks',2230,1,2],['archery',2370,0,2],['aerie',2510,1,3],['mint',2930,0]],
    objectives:[destroy('tollworks','Break the two toll works',[target('foundry',2650,0),target('sanctum',2650,1)]),protect('Keep the council mine and southern barracks alive',[target('mint',410,0),target('barracks',690,1)])],medals:[swift(245),intact(4500)],
    briefing:['Losing or salvaging the marked council mine or southern barracks fails immediately; both toll works or the enemy citadel must fall by 5:00'],
  },

];

/** New chapter briefings derive force counts/levels from the actual paid setup. */
function describeDeployment(placements,map) {
  const names=map.lanes.length===2?['North','South']:['North','Middle','South'];
  return map.lanes.map((_,lane)=>{
    const groups=new Map();
    for(const [type,,placedLane,level=1] of placements)if(placedLane===lane) {
      const key=`level-${level} ${BUILDINGS[type].name}`;groups.set(key,(groups.get(key)||0)+1);
    }
    return `${names[lane]}: ${[...groups].map(([label,count])=>`${count} × ${label}`).join(', ')||'no starting buildings'}`;
  }).join('; ');
}
const firstAuthoredIds=Object.fromEntries(Object.keys(MAPS).map(mapId=>[mapId,new Game({ai:false,mapId}).nextId]));
// Legacy catalogs retain their order, totals and completion semantics.
export const ALL_CAMPAIGN_MISSIONS=[...CAMPAIGN_MISSIONS,...INTRO_MISSIONS];
export const ALL_CAMPAIGN_CHAPTERS=[INTRO_CHAPTER,...CAMPAIGN_CHAPTERS];
export const CAMPAIGN_PROGRESS_MISSIONS=[...ALL_CAMPAIGN_MISSIONS,...ONBOARDING_MISSIONS];
for(const mission of CAMPAIGN_PROGRESS_MISSIONS) {
  mission.mapId=mission.mapId||'classic';
  mission.ai=mission.ai===true;
  if(mission.chapterId==='frontier') {
    const map=MAPS[mission.mapId];
    mission.deployment={player:describeDeployment(mission.playerBuildings,map),enemy:describeDeployment(mission.enemyBuildings,map)};
    mission.briefing=[
      `${map.name}: ${map.width.toLocaleString('en-US')}-unit battlefield, ${map.lanes.length} lanes, ${map.buildLimit} building sites per side`,
      `${mission.startingGold.toLocaleString('en-US')} starting gold; your citadel starts at ${mission.startingHealth.toLocaleString('en-US')} HP; enemy citadel starts at 6,000 HP`,
      `Your deployment: ${mission.deployment.player}`,
      `Enemy deployment: ${mission.deployment.enemy}`,
      mission.ai?`${mission.difficulty[0].toUpperCase()+mission.difficulty.slice(1)} adaptive enemy starts with ${mission.enemyGold||0} gold and ordinary income; it pays for buildings, upgrades and arrow volleys`:'Fixed enemy deployment; no new enemy buildings, upgrades or arrow volleys',
      ...mission.briefing
    ];
  }
  mission.mode=mission.objectives[0].type;
  mission.markedTargets=mission.objectives.flatMap(o=>o.type==='destroy'?o.targets:[]);
  mission.protectedTargets=mission.objectives.flatMap(o=>o.type==='protect'?o.targets:[]);
  if(!mission.optional&&!isOnboardingMission(mission.id))mission.reward=`Unlocks ${CAMPAIGN_MISSIONS.filter(m=>m.prerequisites.includes(mission.id)).map(m=>m.name).join(' / ')||'the campaign epilogue'}`;
}

// Revision 1 remains the exact old contract. New starts explicitly opt into
// revision 2 for the established campaign without copying its sixteen missions.
export const PROGRESSION_CAMPAIGN_MISSIONS=CAMPAIGN_MISSIONS.map(mission=>deepFreeze({
  ...JSON.parse(JSON.stringify(mission)),scenarioRevision:2,mapRevision:1,
  rulesetId:'frontier-campaign-open',rulesetRevision:1,
}));
export function getCampaignMission(id,revision=1) {
  const catalog=revision===1?CAMPAIGN_PROGRESS_MISSIONS:revision===2?PROGRESSION_CAMPAIGN_MISSIONS:[];
  const mission=catalog.find(m=>m.id===id);
  if(!mission)throw new RangeError('Unknown campaign mission or revision: '+String(id)+'@'+String(revision));
  return mission;
}
export function campaignScenarioForGame(game,id) {
  const revision=game?.ruleset?.campaignOnly&&!isOnboardingMission(id)?2:1;
  getCampaignMission(id,revision);
  return {kind:'campaign',id,revision};
}
const missionFor=getCampaignMission;
function missionForGame(game,id,revision) {return missionFor(id,revision??campaignScenarioForGame(game,id).revision);}
export function campaignRulesetAllowed(id,revision,rulesetId) {
  const mission=getCampaignMission(id,revision);
  if(!isOnboardingMission(id))return rulesetId===(mission.rulesetId||'frontier-legacy');
  const minimum=ONBOARDING_MISSIONS.findIndex(m=>m.id===id);
  return CAMPAIGN_RULESET_IDS.indexOf(rulesetId)>=minimum;
}
function missionGameOptions(mission) {
  return {difficulty:mission.difficulty,seed:mission.seed,ai:mission.ai,mapId:mission.mapId,
    ...(mission.rulesetId?{rulesetId:mission.rulesetId,rulesetRevision:mission.rulesetRevision,mapRevision:mission.mapRevision}:{})};
}
export function createCampaignMission(id,{revision=1,progress}={}) {
  const base=missionFor(id,revision);
  const mission=progress!==undefined&&isOnboardingMission(id)?{...base,rulesetId:CAMPAIGN_RULESET_IDS[Math.max(ONBOARDING_MISSIONS.findIndex(m=>m.id===id),getCampaignRoster(progress).stage-1)]}:base;
  return createAuthoredCampaignMission(mission,missionGameOptions(mission));
}
function createAuthoredCampaignMission(mission,options) {
  const game=new Game(options),id=mission.id;
  const s=game.state;
  s.buildings=[];s.effects=[];s.stats.built=[0,0];s.gold=[10000,10000];
  for(const [side,placements] of [[0,mission.playerBuildings],[1,mission.enemyBuildings]])for(const [type,x,lane,level=1] of placements) {
    const result=game.build(type,x,game.map.lanes[lane],side);
    if(!result.ok)throw new Error(`Invalid campaign formation ${id}: ${result.reason}`);
    for(let i=1;i<level;i++)if(!game.upgrade(result.building.id,side).ok)throw new Error(`Invalid campaign upgrade ${id}`);
  }
  s.gold=[mission.startingGold,mission.enemyGold||0];s.bases[0].hp=mission.startingHealth;
  s.income=[currentIncome(game,0),currentIncome(game,1)];
  return game;
}

function campaignRestartIdentity(game,id) {
  const scenario=campaignScenarioForGame(game,id),mission=missionFor(id,scenario.revision);
  if(game?.map?.id!==mission.mapId||game.map.revision!==(mission.mapRevision??1)||
    game?.ruleset?.revision!==(mission.rulesetRevision??1)||!campaignRulesetAllowed(id,scenario.revision,game.ruleset.id)||
    game.difficulty!==mission.difficulty||game.ai!==mission.ai||![1,2,3].includes(game.schemaVersion))
    throw new RangeError('Campaign restart does not match its mission identity: '+String(id));
  return {scenario,map:{id:game.map.id,revision:game.map.revision},ruleset:{id:game.ruleset.id,revision:game.ruleset.revision},
    schemaVersion:game.schemaVersion,difficulty:game.difficulty,ai:game.ai};
}
/** Restart an admitted attempt, not a new profile-selected replay. The caller
 * supplies its admitted mission ID; the engine itself does not carry that ID. */
export function createCampaignRestart(game,id) {
  const before=campaignRestartIdentity(game,id),mission=missionFor(id,before.scenario.revision);
  const candidate=createAuthoredCampaignMission(mission,{
    difficulty:before.difficulty,ai:before.ai,seed:mission.seed,mapId:before.map.id,mapRevision:before.map.revision,
    ...(before.schemaVersion===3?{rulesetId:before.ruleset.id,rulesetRevision:before.ruleset.revision}:{})
  });
  if(JSON.stringify(campaignRestartIdentity(candidate,id))!==JSON.stringify(before))
    throw new RangeError('Campaign restart would change the active battle identity: '+String(id));
  return candidate;
}

/** Deterministic authored IDs distinguish original structures from later rebuilds. */
export function getCampaignTargets(game,id,revision) {
  const mission=missionForGame(game,id,revision);
  if(game.map?.id!==mission.mapId)throw new RangeError(`Campaign battlefield mismatch: ${id} requires ${mission.mapId}, received ${game.map?.id||'unknown'}`);
  return [...mission.markedTargets.map(t=>({...t,side:1,kind:'destroy'})),...mission.protectedTargets.map(t=>({...t,side:0,kind:'protect'}))]
    .map(t=>{
      const placements=t.side?mission.enemyBuildings:mission.playerBuildings;
      const placementIndex=placements.findIndex(([type,x,lane])=>type===t.type&&x===t.x&&lane===t.lane);
      if(placementIndex<0)throw new Error(`Invalid campaign target ${id}: ${t.type} at ${t.x}, lane ${t.lane}`);
      const key=mission.rulesetId?`${mission.rulesetId}@${mission.rulesetRevision}/${mission.mapId}@${mission.mapRevision}`:mission.mapId;
      if(!Object.hasOwn(firstAuthoredIds,key))firstAuthoredIds[key]=new Game(missionGameOptions(mission)).nextId;
      const originalId=firstAuthoredIds[key]+(t.side?mission.playerBuildings.length:0)+placementIndex;
      return {...t,originalId,building:game.state.buildings.find(b=>b.id===originalId&&b.side===t.side&&b.hp>0&&b.type===t.type&&b.x===t.x&&b.lane===t.lane)||null};
    });
}
export function currentIncome(game,side=0) {
  return 5+game.state.buildings.filter(b=>b.side===side&&b.type==='mint'&&b.hp>0).reduce((n,b)=>n+BUILDINGS.mint.income*(1+.5*(b.level-1)),0);
}
function metric(game,objective,atDeadline,targets) {
  const s=game.state;
  if(objective.type==='destroy') {
    const own=targets.filter(t=>t.kind==='destroy'&&objective.targets.some(x=>x.type===t.type&&x.x===t.x&&x.lane===t.lane));
    const count=own.filter(t=>!t.building).length;
    return {met:count===own.length,progress:count/own.length,value:count,target:own.length,text:`${count}/${own.length} targets destroyed`};
  }
  if(objective.type==='protect') {
    const own=targets.filter(t=>t.kind==='protect'&&objective.targets.some(x=>x.type===t.type&&x.x===t.x&&x.lane===t.lane));
    const count=own.filter(t=>t.building).length;
    return {met:count===own.length,failed:count<own.length,progress:count/own.length,value:count,target:own.length,text:`${count}/${own.length} protected structures alive`};
  }
  if(objective.type==='income') {const value=currentIncome(game);return {met:atDeadline&&value>=objective.amount,progress:Math.min(1,value/objective.amount),value,target:objective.amount,text:`${value.toFixed(1)}/${objective.amount} gold/sec`};}
  if(objective.type==='health') {const value=s.bases[0].hp;return {met:value>=objective.amount,failed:value<objective.amount,progress:Math.min(1,value/objective.amount),value,target:objective.amount,text:`${Math.ceil(value)}/${objective.amount} citadel HP required`};}
  if(objective.type==='citadel') {const value=s.bases[1].maxHp-s.bases[1].hp;return {met:s.bases[1].hp<=0,progress:value/s.bases[1].maxHp,value,target:s.bases[1].maxHp,text:`Enemy citadel: ${Math.ceil(s.bases[1].hp)} HP`};}
  const value=Math.min(s.time,objective.seconds);return {met:s.time+1e-7>=objective.seconds,progress:value/objective.seconds,value,target:objective.seconds,text:`${Math.floor(value)}/${objective.seconds}s held`};
}
function medalMet(game,medal) {
  const intro=introMedalMet(game,medal);if(intro!==null)return intro;
  if(medal.type==='time')return game.state.time<=medal.seconds+1e-7;
  if(medal.type==='health')return game.state.bases[0].hp>=medal.amount;
  if(medal.type==='income')return currentIncome(game)>=medal.amount;
  return game.state.buildings.filter(b=>b.side===0&&b.hp>0&&b.level>=2).length>=medal.amount;
}
export function evaluateCampaignMission(game,id,revision) {
  const mission=missionForGame(game,id,revision),s=game.state,atDeadline=s.time+1e-7>=mission.timeLimit;
  const targets=getCampaignTargets(game,id,revision);
  const objectives=mission.objectives.map(o=>({...o,...metric(game,o,atDeadline,targets)}));
  const defeated=s.winner===1||s.winner==='draw'||s.bases[0].hp<=0;
  const broken=objectives.find(o=>o.failed);
  const coreVictory=s.winner===0||s.bases[1].hp<=0;
  const completed=!defeated&&!broken&&(coreVictory||objectives.every(o=>o.met));
  const failed=defeated||!!broken||(!completed&&atDeadline);
  const advancing=objectives.filter(o=>!['protect','health'].includes(o.type));
  let progress=advancing.reduce((n,o)=>n+o.progress,0)/advancing.length;
  if(mission.mode==='income')progress=Math.min(progress,s.time/mission.timeLimit);
  if(completed)progress=1;
  const label=defeated?'Your citadel fell.':broken?`${broken.label}: failed.`:completed?coreVictory?'Enemy citadel destroyed.':'All mission objectives complete.':objectives.map(o=>o.text).join(' · ')+(failed?' · Time expired.':'');
  const medals=mission.medals.map(m=>({...m,earned:completed&&medalMet(game,m)}));
  return {completed,failed,progress:Math.max(0,Math.min(1,progress)),label,objectives,medals,stars:completed?1+medals.filter(m=>m.earned).length:0};
}

/** Small, versioned progress record. No Game state, runtime objects or arbitrary keys. */
export function createCampaignProgress() {return {format:'ironroot-campaign',version:CAMPAIGN_VERSION,missions:{}};}
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
export function normalizeCampaignProgress(raw) {
  const progress=createCampaignProgress();
  if(!plain(raw)||raw.format!==progress.format||raw.version!==CAMPAIGN_VERSION||!plain(raw.missions))return progress;
  for(const mission of CAMPAIGN_PROGRESS_MISSIONS) {
    if(!Object.hasOwn(raw.missions,mission.id))continue;
    const record=raw.missions[mission.id];
    if(!plain(record)||record.completed!==true||!Number.isInteger(record.stars)||record.stars<1||record.stars>3||!Number.isFinite(record.bestTime)||record.bestTime<0||record.bestTime>mission.timeLimit+.25)continue;
    progress.missions[mission.id]={completed:true,stars:record.stars,bestTime:record.bestTime};
  }
  // Orphaned records cannot silently skip the campaign, including edited/corrupt saves.
  for(const mission of CAMPAIGN_PROGRESS_MISSIONS)if(!(isOnboardingMission(mission.id)&&hasReturningProgress(progress))&&mission.prerequisites.some(id=>!progress.missions[id]))delete progress.missions[mission.id];
  return progress;
}
/** Merge independently valid snapshots without allowing a stale tab to erase records. */
export function mergeCampaignProgress(a,b) {
  const left=normalizeCampaignProgress(a),right=normalizeCampaignProgress(b),merged=createCampaignProgress();
  for(const mission of CAMPAIGN_PROGRESS_MISSIONS) {
    const first=left.missions[mission.id],second=right.missions[mission.id];
    if(!first&&!second)continue;
    merged.missions[mission.id]={completed:true,stars:Math.max(first?.stars||0,second?.stars||0),bestTime:Math.min(first?.bestTime??Infinity,second?.bestTime??Infinity)};
  }
  // Each input is prerequisite-complete, so their union is also prerequisite-complete.
  return merged;
}
function hasReturningProgress(clean) {return CAMPAIGN_MISSIONS.some(m=>clean.missions[m.id]?.completed);}
export function getCampaignRoster(progress) {
  const clean=normalizeCampaignProgress(progress),returning=hasReturningProgress(clean);
  const stage=returning||clean.missions['shield-at-the-fork']?3:clean.missions['roadside-watch']?2:1;
  const rulesetId=CAMPAIGN_RULESET_IDS[stage-1];
  return {stage,rulesetId,buildings:Object.keys(getRuleset(rulesetId).buildings),returning,
    unlockedBy:returning?'returning-campaign':stage===3?'shield-at-the-fork':stage===2?'roadside-watch':null};
}
export function isMissionUnlocked(progress,id,revision=1) {
  const mission=missionFor(id,revision),clean=normalizeCampaignProgress(progress),returning=hasReturningProgress(clean);
  if(isOnboardingMission(id)&&returning)return true;
  if(revision===2&&!returning&&!clean.missions['open-three-roads'])return false;
  return mission.prerequisites.every(id=>clean.missions[id]?.completed);
}
export function canUseCampaignRuleset(progress,id,revision,rulesetId) {
  if(!campaignRulesetAllowed(id,revision,rulesetId))return false;
  if(!getRuleset(rulesetId).campaignOnly)return true;
  return CAMPAIGN_RULESET_IDS.indexOf(rulesetId)<getCampaignRoster(progress).stage;
}
/** The explicit launch path. Preview may show locked missions; launch may not. */
export function getCampaignLaunchMission(id,progress) {
  const revision=isOnboardingMission(id)?1:2,mission=getCampaignMission(id,revision),roster=getCampaignRoster(progress);
  return {...mission,scenarioRevision:revision,...(isOnboardingMission(id)?{rulesetId:CAMPAIGN_RULESET_IDS[Math.max(ONBOARDING_MISSIONS.findIndex(m=>m.id===id),roster.stage-1)]}:{} )};
}
export function createProgressionCampaignMission(id,progress) {
  const mission=getCampaignLaunchMission(id,progress);
  if(!isMissionUnlocked(progress,id,mission.scenarioRevision))throw new RangeError('This campaign mission is locked.');
  return createCampaignMission(id,{revision:mission.scenarioRevision,progress});
}
export function getProgressionCampaignOverview(progress) {
  const clean=normalizeCampaignProgress(progress),roster=getCampaignRoster(clean);
  const missions=[...ONBOARDING_MISSIONS,...PROGRESSION_CAMPAIGN_MISSIONS].map(m=>({
    ...getCampaignLaunchMission(m.id,clean),record:clean.missions[m.id]||null,
    unlocked:isMissionUnlocked(clean,m.id,m.scenarioRevision??1),completed:!!clean.missions[m.id],
  }));
  const chapters=[ONBOARDING_CHAPTER,...CAMPAIGN_CHAPTERS].map(c=>{const own=missions.filter(m=>m.chapterId===c.id);return {...c,completed:own.every(m=>m.completed),unlocked:own.some(m=>m.unlocked),cleared:own.filter(m=>m.completed).length,total:own.length,stars:own.reduce((n,m)=>n+(m.record?.stars||0),0),maxStars:own.length*3};});
  const next=missions.find(m=>m.unlocked&&!m.completed&&(!roster.returning||!isOnboardingMission(m.id)));
  const cleared=missions.filter(m=>m.completed).length,stars=missions.reduce((n,m)=>n+(m.record?.stars||0),0);
  return {missions,chapters,cleared,total:missions.length,stars,maxStars:missions.length*3,
    completed:missions.filter(m=>!roster.returning||!isOnboardingMission(m.id)).every(m=>m.completed),
    nextMissionId:next?.id||null,roster,returning:roster.returning,legacyIntroduction:getCampaignOverview(clean).introduction};
}
export function recordCampaignResult(progress,id,game) {
  const revision=campaignScenarioForGame(game,id).revision;
  const clean=normalizeCampaignProgress(progress),mission=missionFor(id,revision),result=evaluateCampaignMission(game,id,revision);
  if(!isMissionUnlocked(clean,id,revision)||!canUseCampaignRuleset(clean,id,revision,game.ruleset.id)||!result.completed)return clean;
  const previous=clean.missions[mission.id];
  clean.missions[id]={completed:true,stars:Math.max(previous?.stars||0,result.stars),bestTime:Math.min(previous?.bestTime??Infinity,game.state.time)};
  return clean;
}
export function getCampaignOverview(progress) {
  const clean=normalizeCampaignProgress(progress);
  const missions=CAMPAIGN_MISSIONS.map(m=>({...m,record:clean.missions[m.id]||null,unlocked:m.prerequisites.every(id=>clean.missions[id]?.completed),completed:!!clean.missions[m.id]}));
  const chapters=CAMPAIGN_CHAPTERS.map(c=>{const own=missions.filter(m=>m.chapterId===c.id);return {...c,completed:own.every(m=>m.completed),unlocked:own.some(m=>m.unlocked),cleared:own.filter(m=>m.completed).length,total:own.length,stars:own.reduce((n,m)=>n+(m.record?.stars||0),0),maxStars:own.length*3};});
  const cleared=missions.filter(m=>m.completed).length,stars=missions.reduce((n,m)=>n+(m.record?.stars||0),0);
  const introMissions=INTRO_MISSIONS.map(m=>({...m,record:clean.missions[m.id]||null,unlocked:m.prerequisites.every(id=>clean.missions[id]?.completed),completed:!!clean.missions[m.id]}));
  const introCleared=introMissions.filter(m=>m.completed).length,introStars=introMissions.reduce((n,m)=>n+(m.record?.stars||0),0);
  const introduction={chapter:{...INTRO_CHAPTER,completed:introCleared===introMissions.length,unlocked:true,cleared:introCleared,total:introMissions.length,stars:introStars,maxStars:introMissions.length*3},missions:introMissions,nextMissionId:introMissions.find(m=>m.unlocked&&!m.completed)?.id||null,completed:introCleared===introMissions.length,recommended:cleared===0&&introCleared<introMissions.length,cleared:introCleared,total:introMissions.length,stars:introStars,maxStars:introMissions.length*3};
  return {missions,chapters,cleared,total:missions.length,stars,maxStars:missions.length*3,completed:cleared===missions.length,nextMissionId:missions.find(m=>m.unlocked&&!m.completed)?.id||null,introduction};
}
export function readCampaignProgressState(storage,key=CAMPAIGN_STORAGE_KEY) {
  let read;
  try{read=storage.read?storage.read(key):{ok:true,value:storage.get(key)};}catch{read={ok:false,value:null};}
  if(!read.ok)return {ok:false,reason:'unavailable',progress:createCampaignProgress()};
  if(read.value===null)return {ok:true,reason:'ready',progress:createCampaignProgress()};
  try{
    const value=JSON.parse(read.value);
    if(!supportedProgress(value))return {ok:false,reason:'unsupported',progress:normalizeCampaignProgress(value)};
    return {ok:true,reason:'ready',progress:normalizeCampaignProgress(value)};
  }catch{return {ok:false,reason:'malformed',progress:createCampaignProgress()};}
}
export function readCampaignProgress(storage,key=CAMPAIGN_STORAGE_KEY) {
  return readCampaignProgressState(storage,key).progress;
}
export function writeCampaignProgress(storage,progress,key=CAMPAIGN_STORAGE_KEY) {
  try {
    const read=storage.read?storage.read(key):{ok:true,value:storage.get(key)};
    if(!read.ok)return false;
    let prior=createCampaignProgress();
    if(read.value!==null){prior=JSON.parse(read.value);if(!supportedProgress(prior))return false;}
    if(!supportedProgress(progress))return false;
    const value=JSON.stringify(mergeCampaignProgress(prior,progress));
    // Verify ownership after validation and never report a dropped write as saved.
    const check=storage.read?storage.read(key):{ok:true,value:storage.get(key)};
    if(!check.ok||check.value!==read.value)return false;
    if(storage.set(key,value)!==true)return false;
    const written=storage.read?storage.read(key):{ok:true,value:storage.get(key)};
    return written.ok&&written.value===value;
  }catch{return false;}
}
function supportedProgress(value) {
  if(!plain(value)||Object.keys(value).length!==3||!['format','version','missions'].every(k=>Object.hasOwn(value,k))||value.format!=='ironroot-campaign'||value.version!==CAMPAIGN_VERSION||!plain(value.missions))return false;
  const clean=normalizeCampaignProgress(value);
  if(Object.keys(value.missions).length!==Object.keys(clean.missions).length)return false;
  return Object.entries(value.missions).every(([id,record])=>plain(record)&&Object.keys(record).length===3&&['completed','stars','bestTime'].every(k=>Object.hasOwn(record,k)&&record[k]===clean.missions[id]?.[k]));
}

