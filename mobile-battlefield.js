// Presentation and suspension only. The simulation, renderer and save schema
// do not depend on viewport dimensions.
export const MIN_PROTECTED_WORLD_HEIGHT = 212;
const rect = r => ({left:r.left,top:r.top,right:r.right ?? r.left+r.width,bottom:r.bottom ?? r.top+r.height,width:r.width,height:r.height});
const finite = r => r && ['left','top','right','bottom','width','height'].every(k=>Number.isFinite(r[k]));
const contains = (outer,inner) => inner.left >= outer.left-.5 && inner.top >= outer.top-.5 && inner.right <= outer.right+.5 && inner.bottom <= outer.bottom+.5;
const overlaps = (a,b) => a.left < b.right-.5 && a.right > b.left+.5 && a.top < b.bottom-.5 && a.bottom > b.top+.5;
export function visibleViewportRect(width,height,visual) {
  const left=Math.max(0,visual?.offsetLeft || 0),top=Math.max(0,visual?.offsetTop || 0);
  const right=Math.min(width,left+(visual?.width ?? width)),bottom=Math.min(height,top+(visual?.height ?? height));
  return {left,top,right,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
export function inspectMobileGeometry({viewport,canvas,regions=[],controls=[]}) {
  viewport=rect(viewport);canvas=rect(canvas);regions=regions.map(rect);controls=controls.map(rect);
  if (![viewport,canvas,...regions,...controls].every(finite)) return {safe:false,reason:'Waiting for the battlefield layout.'};
  if (canvas.height < MIN_PROTECTED_WORLD_HEIGHT-.5 || canvas.width < 128) return {safe:false,reason:'The battlefield needs more visible space.'};
  if (![canvas,...regions,...controls].every(r=>contains(viewport,r))) return {safe:false,reason:'Part of the battlefield or its controls is outside the visible screen.'};
  if (controls.some(r=>r.width<43.5 || r.height<43.5)) return {safe:false,reason:'The controls need more space.'};
  for(let i=0;i<controls.length;i++) {
    if(overlaps(canvas,controls[i])) return {safe:false,reason:'Controls are covering the battlefield.'};
    for(let j=i+1;j<controls.length;j++) if(overlaps(controls[i],controls[j])) return {safe:false,reason:'The controls need more space.'};
  }
  return {safe:true,reason:''};
}
export function createViewportPause() {
  let active=false,blocked=false;
  return {
    get active(){return active;},get blocked(){return blocked;},
    measure(unsafe){const old=`${active}:${blocked}`;if(unsafe)active=true;blocked=!!unsafe;return old!==`${active}:${blocked}`;},
    clear(){active=false;blocked=false;},
  };
}
// Choose a readable toast band without covering the original structures.
export function protectedToastTop(height,toastHeight,obstacles=[]) {
  const margin=8,preferred=(height-toastHeight)/2;
  let bands=[[margin,height-margin]];
  for(const obstacle of obstacles) bands=bands.flatMap(([a,b])=>{
    const top=obstacle.top-4,bottom=obstacle.bottom+4;
    if(bottom<=a||top>=b)return [[a,b]];
    return [[a,Math.min(b,top)],[Math.max(a,bottom),b]].filter(([x,y])=>y>x);
  });
  const fits=bands.filter(([a,b])=>b-a>=toastHeight).map(([a,b])=>Math.max(a,Math.min(b-toastHeight,preferred)));
  return fits.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))[0] ?? Math.max(margin,Math.min(height-toastHeight-margin,preferred));
}
