/** Pure geometry shared by simulation, admission, telegraphs and tactical tests. */
import { RULESETS } from './rulesets.js';

export function supportsFlightOrders(ruleset){
  return !!ruleset&&RULESETS[ruleset.id]===ruleset&&ruleset.combat.flyingCrossLanes===true&&ruleset.movement.policy==='flight-orders-v1';
}
export function flightGateHome(map,ruleset){
  return supportsFlightOrders(ruleset)?map.width/2-ruleset.movement.flightOrders.gateCenterOffset:null;
}
export function flightGateX(map,ruleset,side){
  const home=flightGateHome(map,ruleset);return home===null?null:side===0?home:map.width-home;
}
