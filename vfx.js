// Ironroot Frontier: original, simulation-independent procedural battle accents.
const TAU = Math.PI * 2;
const TYPES = new Set(['build','upgrade','sell','spawn','death','hit','blast','magic','volley']);
const GOLD = ['#f5df9d','#d9b46a','#fff0c7'];
const EARTH = ['#b8ac82','#8d9273','#d3c49a'];
const STONE = ['#727e6b','#b0b493','#887960'];
const VIOLET = ['#c9a3ef','#e8d6ff','#9675c0'];
const TEAM = [['#7eb9a0','#cee5b4'],['#cb8b68','#eac6a0']];
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));

export class BattleVFX {
  constructor({reducedMotion=false, quality='high'}={}) {
    this.reducedMotion=!!reducedMotion;
    this.quality=quality==='low'?'low':'high';
    this.reset();
  }
  reset() {
    this.particles=[];
    this.seen=new WeakSet();
    this.seed=0x1a07f00d;
    this.spawned=0;
    this.effectsSeen=0;
    this.shakeEnergy=0;
    this.shake={x:0,y:0};
    this.time=0;
  }
  random() {
    this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;
    return this.seed/4294967296;
  }
  get limits() { return this.quality==='low'?{particles:80,rubble:12}:{particles:200,rubble:30}; }
  setPreferences({reducedMotion=this.reducedMotion,quality=this.quality}={}) {
    this.reducedMotion=!!reducedMotion;
    this.quality=quality==='low'?'low':'high';
    const limits=this.limits;let rubble=0;
    this.particles=this.particles.filter(p=>p.kind!=='rubble'||++rubble<=limits.rubble).slice(0,limits.particles);
    if(this.reducedMotion) {
      this.shakeEnergy=0;this.shake={x:0,y:0};
      for(const p of this.particles){p.vx=0;p.vy=0;p.gravity=0;p.spin=0;}
    }
  }
  getStats() {
    return {particles:this.particles.length,rubble:this.particles.filter(p=>p.kind==='rubble').length,
      limits:this.limits,spawned:this.spawned,effectsSeen:this.effectsSeen,
      reducedMotion:this.reducedMotion,quality:this.quality};
  }
  getShake() { return {...this.shake}; }
  update(effects,dt,{paused=false}={}) {
    if(paused)return;
    const step=Number.isFinite(dt)?clamp(dt,0,.1):0;
    this.time+=step;
    let keep=0;
    for(const p of this.particles) {
      p.life-=step;
      if(p.life<=0)continue;
      if(!this.reducedMotion) {
        p.vy+=p.gravity*step;
        p.x+=p.vx*step;p.y+=p.vy*step;p.angle+=p.spin*step;
        const drag=Math.exp(-p.drag*step);p.vx*=drag;p.vy*=drag;
      }
      this.particles[keep++]=p;
    }
    this.particles.length=keep;
    this.shakeEnergy=Math.max(0,this.shakeEnergy-step*9);
    if(Array.isArray(effects))for(const e of effects) {
      if(!e||typeof e!=='object'||this.seen.has(e))continue;
      this.seen.add(e);
      if(!TYPES.has(e.type)||!Number.isFinite(e.x)||!Number.isFinite(e.y)||e.life<=0)continue;
      this.effectsSeen++;
      this.emit(e);
    }
    this.shake=this.reducedMotion?{x:0,y:0}:{
      x:Math.sin(this.time*83+.7)*this.shakeEnergy,
      y:Math.sin(this.time*107+2.1)*this.shakeEnergy*.7
    };
  }
  emit(e) {
    const radius=Number.isFinite(e.radius)?clamp(e.radius,0,200):30;
    const team=TEAM[e.side===1?1:0];
    const burst=(count,kind,colors,options={})=>{
      count=Math.max(1,Math.round(count*(this.quality==='low'?.45:1)*(this.reducedMotion?.45:1)));
      const limits=this.limits;
      let rubble=this.particles.reduce((n,p)=>n+(p.kind==='rubble'),0);
      for(let i=0;i<count&&this.particles.length<limits.particles;i++) {
        if(kind==='rubble'&&rubble>=limits.rubble)break;
        const a=this.random()*TAU,spread=options.spread??10;
        const distance=Math.sqrt(this.random())*spread;
        const speed=(options.speed??45)*(.4+this.random()*.6);
        const lifetime=(options.life??.55)*(.75+this.random()*.5);
        const p={kind,x:e.x+Math.cos(a)*distance,y:e.y+(options.offsetY??-10)+Math.sin(a)*distance*(options.flat?.4:1),
          vx:Math.cos(a)*speed,vy:Math.sin(a)*speed*(options.flat?.35:1)-(options.lift??15),
          gravity:options.gravity??0,drag:options.drag??1.5,
          life:lifetime,maxLife:lifetime,size:(options.size??3)*(.65+this.random()*.7),
          angle:this.random()*TAU,spin:(this.random()-.5)*(options.spin??4),
          color:colors[Math.floor(this.random()*colors.length)]};
        if(this.reducedMotion){p.vx=0;p.vy=0;p.gravity=0;p.spin=0;}
        this.particles.push(p);this.spawned++;if(kind==='rubble')rubble++;
      }
    };
    switch(e.type) {
      case 'build':
        burst(17,'dust',EARTH,{spread:44,flat:true,offsetY:17,speed:34,life:.95,size:6,lift:7});
        burst(6,'leaf',team,{spread:25,offsetY:0,speed:28,lift:40,life:.9,size:3});break;
      case 'upgrade':
        burst(15,'diamond',GOLD,{spread:35,offsetY:-20,speed:14,lift:59,life:1.05,size:3});
        burst(7,'wisp',team,{spread:24,offsetY:-12,speed:20,lift:35,life:.8,size:2});break;
      case 'sell':
        burst(11,'dust',EARTH,{spread:38,flat:true,offsetY:12,speed:25,life:.65,size:5});
        burst(6,'diamond',GOLD,{spread:19,speed:24,lift:40,life:.7,size:2.5});break;
      case 'spawn':
        burst(6,'leaf',team,{spread:13,flat:true,offsetY:6,speed:18,lift:12,life:.5,size:2.5});break;
      case 'hit':
        burst(7,'spark',GOLD,{spread:3,speed:80,life:.23,size:2,gravity:75});break;
      case 'death':
        if(radius>30) {
          burst(17,'rubble',STONE,{spread:radius*.6,speed:95,lift:65,gravity:210,life:1.2,size:5,drag:.5});
          burst(19,'dust',EARTH,{spread:radius*.5,flat:true,offsetY:10,speed:45,lift:9,life:1.1,size:8});
          burst(7,'spark',GOLD,{spread:19,speed:70,gravity:90,life:.4,size:2});
          if(!this.reducedMotion)this.shakeEnergy=Math.max(this.shakeEnergy,1.8);
        } else {
          burst(8,'dust',EARTH,{spread:8,flat:true,offsetY:5,speed:24,life:.6,size:4});
          burst(4,'leaf',team,{spread:6,speed:30,life:.55,size:2.5,gravity:40});
        }break;
      case 'blast':
        burst(10,'rubble',STONE,{spread:16,speed:105,lift:45,gravity:200,life:.85,size:3.7,drag:.7});
        burst(14,'spark',GOLD,{spread:8,speed:135,lift:24,gravity:130,life:.44,size:2.2});
        burst(10,'dust',EARTH,{spread:15,flat:true,offsetY:5,speed:60,life:.7,size:6});
        if(!this.reducedMotion)this.shakeEnergy=Math.max(this.shakeEnergy,1.35);break;
      case 'magic':
        burst(15,'wisp',VIOLET,{spread:radius*.45,speed:34,lift:34,life:.8,size:3,spin:5});
        burst(7,'diamond',VIOLET,{spread:radius*.5,speed:18,lift:22,life:.6,size:3.5});break;
      case 'volley':
        burst(25,'spark',GOLD,{spread:radius,speed:55,lift:10,gravity:100,life:.5,size:2});
        burst(10,'rubble',['#8c7751','#c5ad79'],{spread:radius,speed:38,lift:22,gravity:110,life:.7,size:2.2});
        burst(10,'dust',EARTH,{spread:radius,offsetY:4,speed:20,life:.6,size:4});
        if(!this.reducedMotion)this.shakeEnergy=Math.max(this.shakeEnergy,.65);break;
    }
  }
  draw(ctx,viewRect=null,{compact=false}={}) {
    ctx.save();
    for(const p of this.particles) {
      // Secondary decoration is expendable when the battlefield is physically small.
      // Suppress draw work only: particle lifetime, RNG and preference budgets stay intact.
      if((compact||this.quality==='low')&&(p.kind==='dust'||p.kind==='leaf'))continue;
      // Conservative margin includes a spark's tail and growing dust cloud.
      if(viewRect&&(p.x<viewRect.x-24||p.x>viewRect.x+viewRect.width+24||p.y<viewRect.y-24||p.y>viewRect.y+viewRect.height+24))continue;
      const remaining=clamp(p.life/p.maxLife,0,1),age=1-remaining;
      const alpha=remaining*remaining*(3-2*remaining);
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
      ctx.globalAlpha=alpha*(p.kind==='dust'?.32:.9);
      ctx.fillStyle=p.color;ctx.strokeStyle=p.color;ctx.lineWidth=1.5;
      const size=p.size;
      switch(p.kind) {
        case 'dust': {
          const r=size*(this.reducedMotion?1:1+age*1.3);
          ctx.beginPath();ctx.ellipse(0,0,r,r*.65,0,0,TAU);ctx.fill();break;
        }
        case 'spark':
          ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-size*(this.reducedMotion?1:2+remaining*2),0);ctx.lineTo(size,0);ctx.stroke();
          ctx.fillStyle='#fff0c7';ctx.fillRect(-.8,-.8,1.6,1.6);break;
        case 'diamond':
          ctx.beginPath();ctx.moveTo(0,-size*1.7);ctx.lineTo(size,0);ctx.lineTo(0,size*1.7);ctx.lineTo(-size,0);ctx.closePath();ctx.fill();break;
        case 'wisp':
          if(!compact&&this.quality!=='low'){ctx.globalAlpha=alpha*.24;ctx.beginPath();ctx.arc(0,0,size*2.5,0,TAU);ctx.fill();}
          ctx.globalAlpha=alpha*.85;ctx.beginPath();ctx.moveTo(-size*3,size);ctx.quadraticCurveTo(-size,-size*2,0,0);ctx.stroke();
          ctx.beginPath();ctx.arc(0,0,size*.65,0,TAU);ctx.fill();break;
        case 'rubble':
          ctx.beginPath();ctx.moveTo(-size,-size*.5);ctx.lineTo(size*.25,-size);ctx.lineTo(size,size*.15);ctx.lineTo(size*.4,size*.8);ctx.lineTo(-size*.65,size*.6);ctx.closePath();ctx.fill();
          ctx.strokeStyle='#e8d7a5';ctx.globalAlpha=alpha*.45;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-size,-size*.5);ctx.lineTo(size*.25,-size);ctx.lineTo(size,size*.15);ctx.stroke();break;
        case 'leaf':
          ctx.beginPath();ctx.moveTo(-size,0);ctx.quadraticCurveTo(0,-size,size*1.5,0);ctx.quadraticCurveTo(0,size,-size,0);ctx.fill();break;
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
