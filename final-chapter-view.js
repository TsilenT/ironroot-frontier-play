/** Reveal-only presentation. The campaign evaluator and engine own all outcomes. */
import {supportsColossus,COLOSSUS,ENCOUNTER} from './colossus.js';
export function lastEngineView(game){
 if(!supportsColossus(game?.ruleset)||game.state.colossus.phase==='armed')return null;
 const s=game.state,p=s.colossus,boss=s.units.find(u=>u.id===p.bossId&&u.hp>0),emerging=p.phase==='active'&&game.tick<p.triggeredAt+ENCOUNTER.emergeTicks;
 const mode=p.phase==='defeated'?'defeated':emerging?'emerging':boss.x>ENCOUNTER.siegeBoundary?'approach':'siege';
 const goal=s.winner==='draw'?'draw':s.bases[0].hp<=0?'lost':p.phase==='defeated'?(s.bases[1].hp<=0?'complete':'core'):s.bases[1].hp<=0?'boss':'both';
 const objective=goal==='draw'?'The Last Engine and both citadels fell. Draw.':goal==='lost'?'Your citadel fell. Mission failed.':goal==='complete'?'Enemy citadel and Last Engine destroyed. Your citadel survives. Mission complete.':goal==='core'?'Last Engine defeated. Destroy the enemy citadel; keep yours standing.':goal==='boss'?'Enemy citadel destroyed. Defeat the Last Engine; keep your citadel standing.':'Destroy the Last Engine AND enemy citadel; keep your citadel standing.';
 const threat=mode==='emerging'?'The Last Engine is emerging! A single blast cleared troops beside the enemy citadel; buildings and distant troops remain. It can already take damage.':mode==='approach'?'The Last Engine is charging across open ground. At midfield it slows to a siege march.':mode==='siege'?'The Last Engine is in siege march. Its broad body strikes nearby defenders and buildings across all three roads.':'The Last Engine has fallen.';
 const terminal=['complete','lost','draw'].includes(goal),hp=boss?.hp??0;
 const hudLabel=objective+(boss?` Engine ${Math.ceil(hp)}/${COLOSSUS.hp} HP · ${mode}`:'');
 const accessibleLabel=objective+(boss?` Last Engine health ${Math.ceil(hp)} of ${COLOSSUS.hp} HP. ${mode==='siege'?'Siege march':mode==='approach'?'Approaching midfield':'Emerging'}.`:'');
 const phaseMessage=mode==='emerging'?'The Last Engine is emerging and can take damage. All three roads can attack its body.':mode==='approach'?'The Last Engine is approaching midfield.':mode==='siege'?'The Last Engine is in siege march.':'The Last Engine is defeated.';
 const remaining=goal==='core'?'Destroy the enemy citadel; keep yours standing.':goal==='boss'?'Enemy citadel destroyed. Defeat the Engine; keep yours standing.':'Destroy it and the enemy citadel; keep yours standing.';
 const phaseCue=mode==='emerging'?'Emerging · damageable':mode==='approach'?'Fast approach to midfield':mode==='siege'?'Siege march · all roads can hit':'Engine defeated';
 return Object.freeze({name:'The Last Engine',mode,phaseCue,objective,hudLabel,accessibleLabel,announcementKey:mode+':'+goal,announcement:terminal?objective:phaseMessage+' '+remaining,description:terminal?objective:threat+' '+objective+' All three roads can attack its body. Volley can hit its body; rear production can replace losses. No extra deadline or forced citadel drain.',hp,maxHp:COLOSSUS.hp,focus:boss?Object.freeze({x:boss.x,y:boss.y}):null});
}

/** Pure art pose: native position drives tread travel; no animation clock/RNG state. */
export function colossusPose(unit,time,phase,{reducedMotion=false}={}){
 const progress=Math.max(0,Math.min(1,(time-(phase?.triggeredAt??0)*.05)/(ENCOUNTER.emergeTicks*.05))),emerging=!!phase&&progress<1;
 const mode=emerging?'emerging':unit.x>ENCOUNTER.siegeBoundary?'approach':'siege';
 return Object.freeze({mode,panelLift:emerging?(reducedMotion?14:28*(1-progress)**2):0,treadOffset:reducedMotion?0:((unit.x%32)+32)%32,wheelAngle:reducedMotion?0:-unit.x/20,piston:reducedMotion?(mode==='approach'?4:2):Math.sin(unit.x/28)*(mode==='approach'?6:3),contact:unit.attack>0,brace:unit.attack>0?(reducedMotion?4:6*Math.min(1,unit.attack/.22)):0});
}

/** Consume native events even while inaudible; never queue a replay on resume. */
export function createLastEngineAudioObserver(){
 let bound=null,lastTick=null,lastPhase=null,seen=new WeakSet(),lastImpact=-Infinity;
 const isImpact=e=>e.type==='blast'&&e.side===1&&e.radius===180;
 function prime(game){bound=game;lastTick=game?.tick??null;lastPhase=game?.state.colossus?.phase??null;seen=new WeakSet(game?.state.effects??[]);lastImpact=-Infinity;}
 return {
  prime,reset(){bound=null;lastTick=null;lastPhase=null;seen=new WeakSet();lastImpact=-Infinity;},
  isImpact(game,e){return supportsColossus(game?.ruleset)&&game.state.colossus.phase!=='armed'&&isImpact(e);},
  update(game,{audible=false,camera=0,width=0,scale=1}={}){
   if(bound!==game){prime(game);return [];}
   if(!supportsColossus(game?.ruleset)){lastTick=game?.tick??null;return [];}
   const s=game.state,p=s.colossus,delta=game.tick-lastTick,continuous=delta>=0&&delta<=12,cues=[];
   const fresh=lastPhase==='armed'&&p.phase==='active'&&p.triggeredAt>lastTick&&p.triggeredAt<=game.tick;
   const half=width/(2*Math.max(.01,scale)),onScreen=e=>Math.abs(e.x-camera)<=half+COLOSSUS.radius;
   if(audible&&continuous&&fresh)cues.push({name:'engineReveal',pan:0,volume:.8});
   let impact=null;
   for(const e of s.effects){if(seen.has(e))continue;seen.add(e);if(p.phase!=='armed'&&isImpact(e)&&onScreen(e))impact=e;}
   if(audible&&continuous&&!fresh&&impact&&s.time-lastImpact>=.55){lastImpact=s.time;cues.push({name:'engineImpact',pan:Math.max(-1,Math.min(1,(impact.x-camera)/Math.max(1,half))),volume:.65});}
   // Tick jumps, blocked preferences and restored battles consume rather than replay.
   if(!audible||!continuous)lastImpact=s.time;
   lastTick=game.tick;lastPhase=p.phase;return cues;
  },
 };
}
