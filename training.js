/** Isolated, in-memory lessons over the unchanged real engine. No progression or persistence. */
import {Game, BUILDINGS, upgradeCost} from './engine.js';

export const CURRENT_TRAINING_RULESET_ID='frontier-authored-air-local';
export const createCurrentTrainingSession=(options={})=>new TrainingSession({...options,rulesetId:CURRENT_TRAINING_RULESET_ID});

const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const site=(x,label,type,side=0)=>({x,y:450,label,type,side});
const build=(id,type,x,title,prompt)=>({id,kind:'build',type,title,prompt,sites:[site(x,`${BUILDINGS[type].name} site`,type)],successText:`${BUILDINGS[type].name} placed for ${BUILDINGS[type].cost} gold.`});
const watch=(id,title,prompt,successText)=>({id,kind:'watch',title,prompt,successText});
export const TRAINING_LESSONS=freeze([
  {id:'first-barracks',name:'Raise the first company',subtitle:'Place a barracks and watch it work',description:'Choose what to build and where, and your buildings will train troops who march and fight on their own.',startingGold:280,timeLimit:75,playerBuildings:[],enemyBuildings:[],briefing:['280 training gold. Both citadels have their normal 6,000 HP.','Empty field; no starting troops or buildings and no enemy AI.','Time stops for building instructions and runs at normal speed during observations.'],steps:[
    build('place-barracks','barracks',1110,'Place a barracks','Spend 140 gold on Barracks at the marked middle-lane site. You can drag to pan without spending gold, or cancel your choice to select a building already on the field.'),
    watch('watch-spawn','Your army trains itself','Select Start observation to watch the barracks train its first warrior automatically.','Your barracks has trained its first warrior, who will march toward enemy buildings on its own.')
  ]},
  {id:'shield-and-arrow',name:'Put shields in front',subtitle:'Combine warriors and archers',description:'Screen your archers with warriors, who take reduced arrow damage while the archers fire from a safe distance.',startingGold:350,timeLimit:100,playerBuildings:[['barracks',1110]],enemyBuildings:[['archery',1950]],briefing:['350 training gold; one free level-1 barracks already stands at the middle front.','An enemy level-1 archery range stands opposite it, with no new enemy construction.','This lesson gives you free starting buildings whose troops train and fight as they do in battle.'],steps:[
    build('place-support','archery',970,'Build behind the shields','Spend 175 gold on an Archery range at the marked site behind your barracks.'),
    watch('watch-screen','Watch the two roles','Start observation to watch enemy arrows hit your warriors while your archers fire with a warrior still ahead.','Your archers fired with a warrior still ahead of them, and enemy arrows hit your warriors.')
  ]},
  {id:'mine-and-upgrade',name:'Fund the next company',subtitle:'Build income, then improve it',description:'Increase the gold you earn while the battle runs by building a mine, then upgrading it.',startingGold:330,timeLimit:120,playerBuildings:[],enemyBuildings:[],briefing:['330 training gold; no starting buildings or enemies.','A level-1 mine adds 2.5 gold per second to the base income of 5.','The first mine upgrade costs 133 gold and raises its contribution to 3.75 gold per second.'],steps:[
    build('place-mine','mint',410,'Build a gold mine','Choose Gold mine, then the marked rear site. Its 190-gold price leaves 140 gold for the 133-gold first upgrade.'),
    watch('watch-income','See income arrive','Watch your gold rise for two seconds at the combined rate of 7.5 gold per second.','With your mine working, you earned 7.5 gold per second.'),
    {id:'upgrade-mine',kind:'upgrade',type:'mint',title:'Improve the working mine',prompt:'With time stopped, cancel any building choice and select your marked mine to upgrade it to level 2 for 133 gold.',successText:'The paid upgrade gives your level-2 mine more health and income.'},
    watch('watch-upgraded-income','Watch the upgraded mine','Watch for two seconds as your level-2 mine adds 3.75 gold per second, bringing total income to 8.75.','The upgrade cost gold but no extra building site, raising your observed income to 8.75 gold per second.')
  ]},
  {id:'siege-the-tower',name:'Break the stone line',subtitle:'Send siege against a tower',description:'Siege engines can attack towers from beyond their firing radius while dealing triple damage to structures.',startingGold:540,timeLimit:120,playerBuildings:[],enemyBuildings:[['watchtower',1950]],briefing:['540 training gold; your side begins empty.','One free enemy level-1 tower has its normal 1,000 HP. No enemy production or AI.','No health, damage, range or production-speed bonuses are used.'],steps:[
    build('place-foundry','foundry',1250,'Prepare a siege engine','Build a Siege foundry at the marked forward site for 270 gold to send engines into battle at normal training, travel and attack speeds.'),
    watch('watch-siege','Watch the tower fall','Watch your siege engines fire on the marked tower until it falls.','After taking fire from your siege engines, the marked tower fell.')
  ]},
  {id:'answer-the-air',name:'Answer the wings',subtitle:'Use archers against flying enemies',description:'Use archers to hit flying units for bonus damage, since warriors cannot attack them.',startingGold:350,timeLimit:100,playerBuildings:[['barracks',1110]],enemyBuildings:[['aerie',1950]],briefing:['350 training gold and one free level-1 barracks at the middle front.','The enemy trains flyers from one level-1 gryphon aerie and builds nothing new.','To finish, your archers must hit the marked gryphon, and that gryphon must fall.'],steps:[
    build('place-anti-air','archery',970,'Give the company air cover','Build an Archery range at the marked site for 175 gold. The warriors can occupy enemies, but cannot strike a gryphon.'),
    watch('watch-anti-air','Follow a flying target','To finish the lesson, watch your archers hit the marked gryphon before it falls.','Your archers hit the marked gryphon before it fell, doing what warriors and siege engines cannot: attack flyers.')
  ]}
]);
const copy=value=>JSON.parse(JSON.stringify(value));
const lessonById=id=>TRAINING_LESSONS.find(lesson=>lesson.id===id);
const terminal=new Set(['failed','finished','exited']);
/** Attach read-only observers to this private instance, never to Game.prototype.
 * Every original method is called once with its original receiver/arguments.
 * Damage context follows the engine's FIFO damage queue; only applied HP loss counts.
 */
function observeEngine(game){
  const log={events:[],producedBy:new Map()};let firing=null;const queued=[];
  const emit=event=>{if(log.events.length>=1024)log.events.shift();log.events.push(event);};
  const spawn=game._spawn,fire=game._fire,damage=game._damage;
  Object.defineProperty(game,'_spawn',{configurable:true,value:function(...args){
    const before=new Set(this.state.units.map(u=>u.id)),result=spawn.apply(this,args),building=args[0];
    for(const unit of this.state.units)if(!before.has(unit.id)){log.producedBy.set(unit.id,building.id);emit({kind:'spawn',unitId:unit.id,unitType:unit.type,side:unit.side,producerId:building.id,time:this.state.time});}
    return result;
  }});
  Object.defineProperty(game,'_fire',{configurable:true,value:function(...args){
    const [attacker,target]=args,previous=firing;
    if(!attacker||!target)return fire.apply(this,args);
    firing={attackerId:attacker.id,attackerType:attacker.type,attackerSide:attacker.side,attackerX:attacker.x,lane:attacker.lane,producerId:log.producedBy.get(attacker.id)??null,targetId:target.id};
    try{return fire.apply(this,args);}finally{firing=previous;}
  }});
  Object.defineProperty(game,'_damage',{configurable:true,value:function(...args){
    const [target,amount,side]=args,wasQueued=!!this.damageQueue,previousHp=target?.hp,context=firing;
    const result=damage.apply(this,args);
    if(wasQueued){queued.push({target,amount,side,context});return result;}
    let appliedContext=context;
    if(queued.length){const pending=queued.shift();if(pending.target===target&&pending.amount===amount&&pending.side===side)appliedContext=pending.context;else {queued.length=0;appliedContext=null;}}
    const applied=previousHp-target?.hp;
    if(applied>0)emit({kind:'damage',...appliedContext,targetId:target.id,targetType:target.type,targetSide:target.side,targetX:target.x,targetY:target.y,damage:applied,remainingHp:target.hp,killed:target.hp===0,time:this.state.time});
    return result;
  }});
  return log;
}

/** Owns an entirely new Game; deliberately accepts neither a Game nor a saved state. */
export class TrainingSession {
  #game; #lessonIndex=0; #stepIndex=0; #status='instruction'; #paused=false; #recovering=false;
  #attemptId=0; #feedback=''; #results=new Map(); #evidence={}; #placed=new Map(); #stepStartedAt=0;
  #seed; #rulesetId; #targetIds=[]; #lastResult=null; #observed;
  constructor({seed=12012,lessonId=TRAINING_LESSONS[0].id,rulesetId}={}) {
    if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Training seed must be an unsigned 32-bit integer.');
    if(!lessonById(lessonId))throw new Error('Unknown training lesson: '+String(lessonId));
    if(rulesetId!==undefined&&rulesetId!==CURRENT_TRAINING_RULESET_ID)throw new Error('Unsupported practice ruleset.');
    this.#seed=seed;this.#rulesetId=rulesetId;this.#load(lessonId);
  }
  get game(){return this.#game;}
  get lesson(){return TRAINING_LESSONS[this.#lessonIndex];}
  get step(){return this.lesson.steps[this.#stepIndex];}
  #load(id){
    const lesson=lessonById(id);if(!lesson)return this.#reject('Choose one of the listed training lessons.');
    this.#lessonIndex=TRAINING_LESSONS.indexOf(lesson);this.#stepIndex=0;this.#status='instruction';this.#paused=false;this.#recovering=false;
    this.#attemptId++;this.#feedback='';this.#evidence={};this.#placed=new Map();this.#results.delete(id);this.#targetIds=[];this.#lastResult=null;this.#stepStartedAt=0;
    const game=new Game({seed:this.#seed,ai:false,difficulty:'normal',mapId:'classic',...(this.#rulesetId?{rulesetId:this.#rulesetId}:{} )}),s=game.state;
    // Replace the constructor's normal starting barracks only. Authored practice forces are disclosed above.
    s.buildings=[];s.units=[];s.projectiles=[];s.effects=[];s.stats={kills:[0,0],built:[0,0],damage:[0,0]};s.gold=[lesson.startingGold,0];
    for(const [type,x] of lesson.playerBuildings)game._place(type,x,450,0);
    for(const [type,x] of lesson.enemyBuildings)this.#targetIds.push(game._place(type,x,450,1).id);
    this.#game=game;this.#observed=observeEngine(game);return {ok:true};
  }
  #reject(reason){this.#feedback=reason;return {ok:false,reason};}
  #result(outcome,reason){
    const result={lessonId:this.lesson.id,outcome,reason,simulationTime:this.#game.state.time,attemptId:this.#attemptId,evidence:copy(this.#evidence)};
    this.#results.set(this.lesson.id,result);this.#lastResult=result;return result;
  }
  #fail(reason){this.#status='failed';this.#recovering=false;this.#feedback=reason;this.#result('failed',reason);}
  #checkOutcome(){
    const winner=this.#game.state.winner;
    if(winner!==null){this.#fail(winner===0?'The enemy citadel fell before this lesson objective was completed. Retry or skip the lesson.':winner==='draw'?'Both citadels fell. Retry or skip the lesson.':'Your citadel fell. Retry or skip the lesson.');return false;}
    if(this.#game.state.time>=this.lesson.timeLimit-1e-7){this.#fail(`Time is up after ${this.lesson.timeLimit} seconds of practice. Retry or skip. Nothing was saved.`);return false;}
    return true;
  }
  #actionAllowed(kind){
    if(this.#paused)return this.#reject('Practice is paused. Resume first.');
    if(terminal.has(this.#status)||!this.#checkOutcome())return this.#reject(this.#feedback||'This attempt has ended. Retry or choose another lesson.');
    if(this.#status!=='instruction'||this.#recovering||this.step.kind!==kind)return this.#reject('Follow the current instruction before taking that action.');
    return {ok:true};
  }
  #completeStep(){
    this.#recovering=false;this.#feedback=this.step.successText;
    if(this.#stepIndex===this.lesson.steps.length-1){this.#status='lesson-complete';this.#result('completed',this.step.successText);}
    else this.#status='step-complete';
  }
  #requiredBuilding(){const id=this.#placed.get(this.step.type);return this.#game.state.buildings.find(b=>b.id===id&&b.side===0&&b.hp>0);}
  #requiredCost(){if(this.step.kind==='build')return BUILDINGS[this.step.type].cost;if(this.step.kind==='upgrade'){const b=this.#requiredBuilding();return b&&b.level<3?upgradeCost(b):null;}return null;}
  #hints(){
    if(this.step.kind==='build')return this.step.sites.map(copy);
    if(this.step.kind==='upgrade'){const b=this.#requiredBuilding();return b?[{x:b.x,y:b.y,label:'Select this mine to upgrade',type:b.type,buildingId:b.id,side:0}]:[];}
    if(this.lesson.id==='first-barracks'||this.lesson.id==='mine-and-upgrade'){
      return [...this.#placed.values()].map(id=>this.#game.state.buildings.find(b=>b.id===id)).filter(Boolean).map(b=>({x:b.x,y:b.y,label:BUILDINGS[b.type].name,type:b.type,buildingId:b.id,side:0}));
    }
    const hints=this.#targetIds.map(id=>this.#game.state.buildings.find(b=>b.id===id)).filter(Boolean).map(b=>({x:b.x,y:b.y,label:'Lesson target: '+BUILDINGS[b.type].name,type:b.type,buildingId:b.id,side:1}));
    const air=this.#game.state.units.find(u=>u.id===this.#evidence.airTargetId);if(air)hints.push({x:air.x,y:air.y,label:'Tracked gryphon',type:air.type,unitId:air.id,side:1});return hints;
  }
  snapshot(){
    const operational=!terminal.has(this.#status)&&this.#status!=='lesson-complete'&&this.#status!=='step-complete';
    const cost=this.#requiredCost(),canRecoverGold=operational&&!this.#paused&&!this.#recovering&&this.#status==='instruction'&&cost!==null&&this.#game.state.gold[0]<cost;
    const canContinue=!this.#paused&&(['step-complete','lesson-complete'].includes(this.#status)||(this.#status==='instruction'&&this.step.kind==='watch'));
    const shouldRun=!this.#paused&&this.#status==='active';
    return {lessonIndex:this.#lessonIndex,lesson:copy(this.lesson),stepIndex:this.#stepIndex,step:copy(this.step),status:this.#status,paused:this.#paused,recovering:this.#recovering,shouldRun,canContinue,
      continueLabel:this.#status==='lesson-complete'?(this.#lessonIndex===TRAINING_LESSONS.length-1?'Review training':'Next lesson'):this.#status==='step-complete'?'Continue':'Start observation',
      availableBuildings:operational&&!this.#recovering&&this.#status==='instruction'&&this.step.kind==='build'?[this.step.type]:[],targetHints:this.#hints(),canRecoverGold,requiredGold:cost,
      feedback:this.#feedback,objective:this.step.prompt,attemptId:this.#attemptId,evidence:copy(this.#evidence),results:[...this.#results.values()].map(copy),lastResult:copy(this.#lastResult),
      summary:{untried:TRAINING_LESSONS.length-this.#results.size,completed:[...this.#results.values()].filter(r=>r.outcome==='completed').length,skipped:[...this.#results.values()].filter(r=>r.outcome==='skipped').length,failed:[...this.#results.values()].filter(r=>r.outcome==='failed').length,total:TRAINING_LESSONS.length},
      remainingSeconds:Math.max(0,this.lesson.timeLimit-this.#game.state.time)};
  }
  build(type,x,y){
    const allowed=this.#actionAllowed('build');if(!allowed.ok)return allowed;
    if(type!==this.step.type)return this.#reject(`This step needs ${BUILDINGS[this.step.type].name}.`);
    if(!this.step.sites.some(point=>point.x===x&&point.y===y))return this.#reject('Choose the marked site for this step.');
    const result=this.#game.build(type,x,y,0);if(!result.ok)return this.#reject(result.reason+' Select Wait for income, or restart the lesson.');
    this.#placed.set(type,result.building.id);this.#completeStep();return result;
  }
  upgrade(id){
    const allowed=this.#actionAllowed('upgrade');if(!allowed.ok)return allowed;
    const building=this.#requiredBuilding();if(!building||building.id!==id)return this.#reject('Select the marked mine you built in this attempt.');
    if(building.level!==1)return this.#reject('This step requires the original level-1 mine. Retry the lesson.');
    const result=this.#game.upgrade(id,0);if(!result.ok)return this.#reject(result.reason+' Select Wait for income, or restart the lesson.');
    this.#completeStep();return result;
  }
  continue(){
    if(this.#paused)return this.#reject('Practice is paused. Resume first.');
    if(this.#status==='lesson-complete'){
      if(this.#lessonIndex===TRAINING_LESSONS.length-1){this.#status='finished';this.#feedback='Practice review: completed, skipped and failed lessons. No rewards or campaign progress were saved.';return {ok:true};}
      return this.#load(TRAINING_LESSONS[this.#lessonIndex+1].id);
    }
    if(terminal.has(this.#status)||!this.#checkOutcome())return this.#reject(this.#feedback||'This attempt has ended. Retry or choose another lesson.');
    if(this.#status==='step-complete'){this.#stepIndex++;this.#status='instruction';this.#feedback='';this.#stepStartedAt=this.#game.state.time;return {ok:true};}
    if(this.#status==='instruction'&&this.step.kind==='watch'){this.#status='active';this.#stepStartedAt=this.#game.state.time;this.#feedback='Observation running at normal speed.';return {ok:true};}
    return this.#reject('Complete the current action or observation before continuing.');
  }
  recoverGold(){
    if(!this.snapshot().canRecoverGold)return this.#reject('Wait for income is available when you need more gold for this step.');
    if(!this.#checkOutcome())return {ok:false,reason:this.#feedback};
    this.#recovering=true;this.#status='active';this.#feedback='Waiting for gold. Combat continues until you can afford the action, then time pauses.';return {ok:true};
  }
  setPaused(paused){
    if(typeof paused!=='boolean')return this.#reject('Pause must be true or false.');
    if(terminal.has(this.#status))return this.#reject('This attempt has ended.');
    this.#paused=paused;return {ok:true};
  }
  retry(){if(this.#status==='exited')return this.#reject('Training is closed.');return this.#load(this.lesson.id);}
  startLesson(id){if(this.#status==='exited')return this.#reject('Training is closed.');return this.#load(id);}
  skip(){
    if(terminal.has(this.#status)&&this.#status!=='failed')return this.#reject('Training has ended.');
    if(this.#status!=='lesson-complete')this.#result('skipped','Skipped by the player; not completed.');
    if(this.#lessonIndex===TRAINING_LESSONS.length-1){this.#status='finished';this.#paused=false;this.#recovering=false;this.#feedback='Practice review. Skipped lessons do not count as completed.';return {ok:true};}
    return this.#load(TRAINING_LESSONS[this.#lessonIndex+1].id);
  }
  exit(){this.#status='exited';this.#paused=false;this.#recovering=false;this.#feedback='Training closed. This practice attempt is not saved.';return {ok:true};}
  #observe(){
    const s=this.#game.state,e=this.#evidence,events=this.#observed.events.splice(0);
    if(this.#recovering||this.step.kind!=='watch')return;
    for(const event of events){
      if(event.kind==='spawn'){
        if(this.lesson.id==='first-barracks'&&event.producerId===this.#placed.get('barracks')&&event.side===0&&event.unitType==='warrior'){
          e.spawnedWarriorId=event.unitId;e.producerId=event.producerId;
        }
        if(this.lesson.id==='answer-the-air'&&event.side===1&&event.unitType==='gryphon'&&event.producerId===this.#targetIds[0]&&!e.airTargetId)e.airTargetId=event.unitId;
        continue;
      }
      if(this.lesson.id==='shield-and-arrow'){
        if(event.attackerType==='archer'&&event.attackerSide===1&&event.targetType==='warrior'&&event.targetSide===0)e.shieldHit={warriorId:event.targetId,damage:event.damage,time:event.time};
        if(event.attackerType==='archer'&&event.attackerSide===0&&event.producerId===this.#placed.get('archery')){
          const screen=s.units.find(u=>u.type==='warrior'&&u.side===0&&u.lane===event.lane&&u.x>event.attackerX&&u.hp>0);
          if(screen)e.supportShot={archerId:event.attackerId,producerId:event.producerId,warriorId:screen.id,targetId:event.targetId,damage:event.damage,time:event.time};
        }
      }
      if(this.lesson.id==='siege-the-tower'&&event.targetId===this.#targetIds[0]){
        if(event.attackerType==='siege'&&event.attackerSide===0&&event.producerId===this.#placed.get('foundry'))e.siegeHit={targetId:event.targetId,attackerId:event.attackerId,producerId:event.producerId,damage:event.damage,time:event.time};
        if(event.killed&&e.siegeHit)e.towerDestroyed={targetId:event.targetId,time:event.time};
      }
      if(this.lesson.id==='answer-the-air'&&event.targetId===e.airTargetId){
        if(event.attackerType==='archer'&&event.attackerSide===0&&event.producerId===this.#placed.get('archery'))e.archerAirHit={targetId:event.targetId,attackerId:event.attackerId,producerId:event.producerId,damage:event.damage,time:event.time};
        if(event.killed&&e.archerAirHit)e.gryphonDefeated={targetId:event.targetId,time:event.time};
      }
    }
  }
  #watchComplete(){
    const e=this.#evidence,s=this.#game.state;
    if(this.step.id==='watch-spawn')return !!e.spawnedWarriorId;
    if(this.step.id==='watch-screen')return !!e.shieldHit&&!!e.supportShot;
    if(this.step.id==='watch-siege')return !!e.siegeHit&&!!e.towerDestroyed;
    if(this.step.id==='watch-anti-air')return !!e.archerAirHit&&!!e.gryphonDefeated;
    if(this.step.id==='watch-income'||this.step.id==='watch-upgraded-income'){
      const level=this.step.id==='watch-income'?1:2,target=level===1?7.5:8.75,b=s.buildings.find(b=>b.id===this.#placed.get('mint'));
      if(s.time-this.#stepStartedAt>=2-1e-7&&b?.level===level&&Math.abs(s.income[0]-target)<1e-7){e[this.step.id]={income:s.income[0],time:s.time,mineId:b.id};return true;}
    }
    return false;
  }
  update(dt){
    if(!Number.isFinite(dt)||dt<=0)return {ok:false,reason:'Elapsed time must be positive and finite.'};
    if(terminal.has(this.#status)||['lesson-complete','step-complete'].includes(this.#status))return {ok:true};
    if(!this.#checkOutcome())return {ok:false,reason:this.#feedback};
    if(this.#paused||this.#status!=='active')return {ok:true};
    // Same 0.25s per-call cap as Game.update, with per-engine-tick observations.
    let remaining=Math.min(dt,.25);
    while(remaining>1e-9&&this.#status==='active'){
      const part=Math.min(.05,remaining);
      this.#game.update(part);remaining-=part;
      this.#observe();
      // Engine loss or draw wins over an objective on the same tick. A win is not a training objective.
      if(!this.#checkOutcome())break;
      if(this.#recovering){const cost=this.#requiredCost();if(cost===null){this.#fail('The required practice building is no longer available. Retry the lesson.');break;}if(this.#game.state.gold[0]>=cost){this.#recovering=false;this.#status='instruction';this.#feedback='You have enough gold. Time is paused. Complete the highlighted action.';}}
      else if(this.#watchComplete())this.#completeStep();
    }
    return {ok:this.#status!=='failed',...(this.#status==='failed'?{reason:this.#feedback}:{})};
  }
}
