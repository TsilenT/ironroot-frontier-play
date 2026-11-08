/**
 * Ironroot Frontier audio, composed and synthesized specifically for this game.
 * No recordings, sample packs, network requests, or third-party compositions.
 * Lazy Web Audio initialization keeps autoplay and reduced-noise preferences intact.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const midi = note => 440 * 2 ** ((note - 69) / 12);
const EPSILON = 0.0001;
const SCENES = new Set(['menu', 'battle', 'paused', 'victory', 'defeat']);
const ALIASES = {select:'click',warrior:'sword',hit:'sword',archer:'arrow',tower:'arrow',wizard:'magic',blast:'siege',volley:'strike',death:'collapse',win:'victory',lose:'defeat',construction:'build'};
const COOLDOWNS = {click:.035,error:.15,build:.10,upgrade:.14,sell:.10,spawn:.28,sword:.105,arrow:.13,siege:.28,magic:.22,gryphon:.35,strike:.30,collapse:.22,warning:2,start:.50,victory:2,defeat:2,pause:.15,resume:.15};
export const SOUND_NAMES = Object.freeze(Object.keys(COOLDOWNS));
export const AUDIO_CREDITS = Object.freeze({title:'The Long Reach — Hearth to Standard',composer:'Original score for Ironroot Frontier',source:'Procedural Web Audio composition and sound design. No third-party audio assets.',bpm:108,bars:64,key:'D minor',seconds:64*4*60/108});
export const AUDIO_SECTIONS = Object.freeze(['Hearth','The Road','The Crossing','The Standard']);
const EIGHTH = 60/AUDIO_CREDITS.bpm/2;
const ACTIVE_SCENES = new Set(['menu','battle']);

// Original 16-bar theme: Dm–Bb–F–C, then Gm–Dm–Bb–A to return home.
const CHORDS = [
  [50,53,57],[50,53,57],[46,50,53],[46,50,53],
  [48,53,57],[48,53,57],[48,52,55],[48,52,55],
  [43,46,50],[43,46,50],[45,50,53],[45,50,53],
  [46,50,53],[46,50,53],[45,49,52],[45,49,52]
];
const ROOTS = [38,38,34,34,41,41,36,36,31,31,38,38,34,34,33,33];
// Each entry is an eighth-note slot; null holds a breath in the melody.
const THEME = [
  [74,null,77,76,74,null,69,null], [72,74,77,null,76,null,72,null],
  [70,null,74,77,79,null,77,null], [74,null,72,70,69,null,65,null],
  [69,null,72,74,77,null,76,null], [72,null,69,65,67,69,72,null],
  [67,null,72,76,79,null,76,74], [72,null,71,67,69,null,null,null],
  [70,null,74,77,79,null,81,null], [82,null,81,79,77,null,74,null],
  [81,null,77,74,76,null,77,79], [81,null,79,77,74,null,72,null],
  [70,null,74,77,79,77,74,null], [77,null,74,70,69,null,67,null],
  [69,null,73,76,81,null,79,76], [73,null,69,67,64,null,69,null]
];

// Two new 16-bar answers develop the same D–F–E–D / A cell. Each row
// remains one bar, with written rests; no random note selection or samples.
const ROAD_CHORDS = [[50,53,57],[50,53,57],[48,53,57],[48,53,57],[43,46,50],[43,46,50],[46,50,53],[46,50,53],[45,50,53],[45,50,53],[48,52,55],[48,52,55],[45,49,52],[45,49,52],[50,53,57],[50,53,57]];
const ROAD_ROOTS = [38,38,41,41,31,31,34,34,38,38,36,36,33,33,38,38];
const ROAD_THEME = [
  [69,null,74,null,77,76,74,null],[65,null,69,72,74,null,69,null],
  [69,null,72,null,77,null,76,72],[74,72,69,null,65,null,null,null],
  [67,null,70,null,74,77,74,null],[79,null,77,74,70,null,67,null],
  [70,null,74,77,82,null,81,77],[79,77,74,null,70,null,null,null],
  [77,null,76,74,69,null,65,null],[62,null,65,69,74,null,null,null],
  [67,null,72,76,79,null,76,null],[74,72,67,null,64,null,null,null],
  [69,null,73,76,79,null,76,null],[73,null,69,64,61,null,null,null],
  [62,null,69,null,74,null,77,76],[74,null,null,null,69,null,null,null]
];
const CROSSING_CHORDS = [[48,53,57],[48,53,57],[48,52,55],[48,52,55],[50,53,57],[50,53,57],[46,50,53],[46,50,53],[43,46,50],[43,46,50],[45,50,53],[45,50,53],[45,50,52],[45,50,52],[45,49,52],[45,49,52]];
const CROSSING_ROOTS = [41,41,36,36,38,38,34,34,31,31,38,38,33,33,33,33];
const CROSSING_THEME = [
  [77,null,null,null,72,null,69,null],[65,null,null,null,69,null,null,null],
  [76,null,null,null,72,null,67,null],[64,null,null,null,67,null,null,null],
  [74,null,null,null,69,null,65,null],[62,null,null,null,65,null,69,null],
  [70,null,null,null,74,null,77,null],[74,null,null,null,70,null,null,null],
  [67,null,null,null,70,null,74,null],[77,null,74,null,70,null,null,null],
  [74,null,null,null,77,null,76,null],[74,null,69,null,65,null,null,null],
  [74,null,null,null,76,null,74,null],[69,null,null,null,64,null,null,null],
  [73,null,null,null,76,null,79,null],[76,null,73,null,69,null,null,null]
];
const SCORE = [
  {chords:CHORDS,roots:ROOTS,theme:THEME,density:.55},
  {chords:ROAD_CHORDS,roots:ROAD_ROOTS,theme:ROAD_THEME,density:.8},
  {chords:CROSSING_CHORDS,roots:CROSSING_ROOTS,theme:CROSSING_THEME,density:.45},
  {chords:CHORDS,roots:ROOTS,theme:THEME,density:1}
];

export class GameAudio {
  constructor({muted=true,volume=.65,musicVolume=.7,sfxVolume=.85,musicEnabled=true,sfxEnabled=true,contextFactory=null}={}) {
    this.muted=!!muted;
    this.volume=clamp(volume,0,1);
    this.musicVolume=clamp(musicVolume,0,1);
    this.sfxVolume=clamp(sfxVolume,0,1);
    this.musicEnabled=!!musicEnabled;
    this.sfxEnabled=!!sfxEnabled;
    this.scene='menu';
    this.musicScene='menu';
    this.pendingScene=null;
    this.intensity=.25;
    this.mixIntensity=.25;
    this.energy='calm';
    this.context=null;
    this.available=true;
    this.destroyed=false;
    this.voices=new Set();
    this.lastPlayed=new Map();
    this.timer=null;
    this.step=0;
    this.nextStepTime=0;
    this.contextFactory=contextFactory;
    this.noiseSeed=0x49524f4e;
    this.stats={musicNotes:0,soundEffects:0,droppedEffects:0,transitions:0,peakVoices:0};
  }

  /** Must be called from a pointer/key activation. Returns false if unavailable. */
  async unlock() {
    if(this.destroyed)return false;
    try {
      if(!this.context) {
        const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
        if(!this.contextFactory&&!Context){this.available=false;return false;}
        this.context=this.contextFactory?this.contextFactory():new Context({latencyHint:'interactive'});
        this._createGraph();
      }
      if(this.context.state==='suspended')await this.context.resume();
      if(this.context.state==='closed')return false;
      this.available=true;
      this._updateGains();
      this._startScheduler();
      return this.context.state==='running';
    } catch {
      this.available=false;
      this._stopScheduler();
      return false;
    }
  }

  setMuted(value) {
    if(this.destroyed)return;
    this.muted=!!value;
    this._updateGains();
    if(this.muted){this._stopScheduler();this._stopVoices(null,.04);}
    else this._startScheduler();
  }
  setMusicEnabled(value){
    this.musicEnabled=!!value;this._updateGains();
    if(!this.musicEnabled){this._stopScheduler();this._stopVoices('music',.04);}
    else this._startScheduler();
  }
  setSfxEnabled(value){this.sfxEnabled=!!value;this._updateGains();if(!this.sfxEnabled)this._stopVoices('sfx',.04);}
  setVolume(value){this.volume=clamp(value,0,1);this._updateGains();}
  setMusicVolume(value){this.musicVolume=clamp(value,0,1);this._updateGains();}
  setSfxVolume(value){this.sfxVolume=clamp(value,0,1);this._updateGains();}
  setIntensity(value){
    this.intensity=clamp(value,0,1);
    const previous=this.energy;
    // Hysteresis prevents percussion from chattering around a threshold.
    if(this.intensity>=.75)this.energy='critical';
    else if(this.intensity<.28)this.energy='calm';
    else if((this.energy==='calm'&&this.intensity>=.4)||(this.energy==='critical'&&this.intensity<.6))this.energy='engaged';
    // The app calls this every frame. Only meaningful changes rewrite ramps.
    if(previous!==this.energy||Math.abs(this.mixIntensity-this.intensity)>=.04){this.mixIntensity=this.intensity;this._updateGains();}
  }
  setScene(scene) {
    if(this.destroyed||!SCENES.has(scene)||scene===this.scene)return;
    const previous=this.scene;
    this.scene=scene;
    if(ACTIVE_SCENES.has(previous)&&ACTIVE_SCENES.has(scene)&&this.timer!==null){
      // Keep harmonic position; the next scheduled downbeat changes the mix.
      this.pendingScene=scene===this.musicScene?null:scene;
      return;
    }
    this.pendingScene=null;
    this._stopScheduler();
    this._stopVoices('music',.14);
    this.musicScene=scene;
    // Pause resumes on the next downbeat of the same long-form arrangement.
    this.step=Math.ceil(this.step/8)*8;
    this.nextStepTime=this.context?this.context.currentTime+.16:0;
    this._updateGains();
    this._startScheduler();
  }

  /** SFX are bounded and rate-limited. pan is -1 (left) to +1 (right). */
  play(name,{pan=0,volume=1}={}) {
    name=ALIASES[name]||name;
    const c=this.context;
    if(this.destroyed||this.muted||!this.sfxEnabled||!c||c.state!=='running'||!Object.hasOwn(COOLDOWNS,name)||this.volume<=0||this.sfxVolume<=0)return false;
    const now=c.currentTime;
    if(now-(this.lastPlayed.get(name)??-Infinity)<COOLDOWNS[name]){this.stats.droppedEffects++;return false;}
    if(this._voiceCount('sfx')>=24){
      // A crowded clash must never swallow the result or the player's rally.
      if(['victory','defeat','warning','strike','start'].includes(name))this._stopVoices('sfx',0);
      else {this.stats.droppedEffects++;return false;}
    }
    this.lastPlayed.set(name,now);
    this.stats.soundEffects++;
    if(['warning','strike','start','victory','defeat'].includes(name))this._duckMusic(now,name==='victory'?2.7:name==='defeat'?1.8:.85);
    const at=now+.006, p=clamp(pan,-1,1),v=clamp(volume,0,1);
    const note=(frequency,duration,gain,options={})=>this._tone(at+(options.delay||0),frequency,duration,gain*v,{kind:'sfx',pan:p,...options});
    const noise=(duration,gain,options={})=>this._noise(at+(options.delay||0),duration,gain*v,{kind:'sfx',pan:p,...options});
    const bell=(frequency,delay=0,gain=.18)=>{note(frequency,.38,gain,{type:'sine',delay});note(frequency*2.756,.16,gain*.18,{type:'sine',delay});};
    switch(name) {
      case 'click':note(740,.055,.16,{type:'sine',end:510});break;
      case 'error':note(150,.11,.20,{type:'triangle',end:100});note(124,.10,.11,{type:'triangle',delay:.085});break;
      case 'build':
        noise(.16,.20,{filter:'lowpass',frequency:950});note(115,.16,.32,{type:'sine',end:48});
        bell(midi(62),.07,.13);bell(midi(69),.15,.10);break;
      case 'upgrade':[62,65,69,74].forEach((n,i)=>bell(midi(n),i*.085,.15));noise(.35,.035,{filter:'highpass',frequency:3000});break;
      case 'sell':[74,69,65].forEach((n,i)=>bell(midi(n),i*.065,.12));break;
      case 'spawn':note(220,.13,.08,{type:'triangle',end:330});noise(.09,.06,{filter:'bandpass',frequency:1400,q:1});break;
      case 'sword':
        noise(.075,.16,{filter:'bandpass',frequency:2100,q:1.2});note(320,.08,.12,{type:'triangle',end:95});
        note(1840,.09,.042,{type:'sine'});note(2760,.065,.024,{type:'sine'});break;
      case 'arrow':noise(.14,.10,{filter:'bandpass',frequency:2100,end:700,q:2});note(730,.035,.045,{type:'triangle',end:230});break;
      case 'siege':
        note(105,.62,.37,{type:'sine',end:29});noise(.65,.24,{filter:'lowpass',frequency:1150,end:180});
        noise(.09,.12,{filter:'highpass',frequency:1400});break;
      case 'magic':
        note(440,.25,.12,{type:'sine',end:1320});note(660,.32,.08,{type:'triangle',end:1760,delay:.025,cutoff:2200});
        noise(.24,.055,{filter:'bandpass',frequency:2800,end:600,q:2});break;
      case 'gryphon':
        noise(.24,.15,{filter:'bandpass',frequency:650,end:1600,q:3});note(820,.20,.07,{type:'sawtooth',end:310,cutoff:1250});break;
      case 'strike':
        note(140,.85,.43,{type:'sine',end:27});noise(.95,.31,{filter:'lowpass',frequency:2700,end:190});
        [62,69,74].forEach((n,i)=>note(midi(n),.60,.085,{type:'triangle',delay:.035*i,cutoff:1800}));break;
      case 'collapse':noise(.46,.20,{filter:'lowpass',frequency:1300,end:200});note(85,.42,.24,{type:'sine',end:35});break;
      case 'warning':[0,.24,.48].forEach(delay=>note(392,.14,.14,{type:'triangle',delay,cutoff:1000}));break;
      case 'start':[50,57,62,65,69].forEach((n,i)=>note(midi(n),.55,.11,{type:'triangle',delay:i*.10,attack:.02,cutoff:1500}));break;
      case 'victory':
        [62,65,69,74,77,81,86].forEach((n,i)=>note(midi(n),i===6?1.55:.40,.12,{type:'triangle',delay:i*.15,attack:.015,cutoff:2400}));
        [50,57,62,65].forEach(n=>note(midi(n),1.80,.065,{type:'sine',delay:.90,attack:.04}));break;
      case 'defeat':
        [65,64,62,57,50].forEach((n,i)=>note(midi(n),.65,.105,{type:'triangle',delay:i*.24,attack:.025,cutoff:1100}));break;
      case 'pause':note(440,.10,.12,{type:'sine',end:330});break;
      case 'resume':note(330,.10,.12,{type:'sine',end:440});break;
    }
    return true;
  }

  /** Useful for diagnostics, without exposing the graph to the game loop. */
  getState(){return {available:this.available,unlocked:!!this.context&&this.context.state==='running',muted:this.muted,volume:this.volume,musicVolume:this.musicVolume,sfxVolume:this.sfxVolume,musicEnabled:this.musicEnabled,sfxEnabled:this.sfxEnabled,scene:this.scene,musicScene:this.musicScene,pendingScene:this.pendingScene,section:AUDIO_SECTIONS[Math.floor(this.step/128)%4],bar:Math.floor(this.step/8)%AUDIO_CREDITS.bars,intensity:this.intensity,energy:this.energy,activeVoices:this.voices.size,scheduling:this.timer!==null,...this.stats};}
  async destroy(){
    if(this.destroyed)return;
    this.destroyed=true;
    this._stopScheduler();
    this._stopVoices(null,0);
    this.lastPlayed.clear();
    try{if(this.context&&this.context.state!=='closed')await this.context.close();}catch{}
    this.context=null;
  }

  _createGraph(){
    const c=this.context;
    this.master=c.createGain();
    this.music=c.createGain();
    this.musicDuck=c.createGain();
    this.sfx=c.createGain();
    this.limiter=c.createDynamicsCompressor();
    this.limiter.threshold.value=-14;this.limiter.knee.value=12;this.limiter.ratio.value=5;this.limiter.attack.value=.004;this.limiter.release.value=.18;
    this.music.connect(this.musicDuck);this.musicDuck.connect(this.master);this.sfx.connect(this.master);this.master.connect(this.limiter);this.limiter.connect(c.destination);
    this.layers={};
    for(const key of ['pad','bass','theme','answer','arp','drums']){const gain=c.createGain();gain.connect(this.music);this.layers[key]=gain;}
    // An inexpensive, quiet echo gives the score room without external impulses.
    this.echo=c.createDelay(.8);this.echo.delayTime.value=60/AUDIO_CREDITS.bpm*.75;
    this.echoFilter=c.createBiquadFilter();this.echoFilter.type='lowpass';this.echoFilter.frequency.value=1900;
    this.echoGain=c.createGain();this.echoGain.gain.value=.13;
    this.layers.theme.connect(this.echo);this.layers.arp.connect(this.echo);
    this.echo.connect(this.echoFilter);this.echoFilter.connect(this.echoGain);this.echoGain.connect(this.music);
    const length=Math.ceil(c.sampleRate*1.3);
    this.noiseBuffer=c.createBuffer(1,length,c.sampleRate);
    const data=this.noiseBuffer.getChannelData(0);
    for(let i=0;i<length;i++){this.noiseSeed=(Math.imul(this.noiseSeed,1664525)+1013904223)>>>0;data[i]=this.noiseSeed/2147483648-1;}
    this._updateGains(true);
  }
  _ramp(param,value,duration=.08,immediate=false,at=this.context.currentTime){
    // Hold the instantaneous value, including when interrupting a prior ramp.
    if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(at);
    else {param.cancelScheduledValues(at);param.setValueAtTime(param.value,at);}
    if(immediate)param.setValueAtTime(value,at);
    else param.linearRampToValueAtTime(value,at+duration);
  }
  _updateGains(immediate=false,at=this.context?.currentTime){
    if(!this.context||!this.master||this.destroyed)return;
    this._ramp(this.master.gain,this.muted?0:this.volume*.66,.04,immediate);
    this._ramp(this.sfx.gain,this.sfxEnabled?this.sfxVolume:0,.06,immediate);
    const active=this.musicEnabled&&ACTIVE_SCENES.has(this.scene);
    this._ramp(this.music.gain,active?this.musicVolume:0,.16,immediate);
    const menu=this.musicScene==='menu',i=this.mixIntensity;
    this._ramp(this.layers.pad.gain,menu?.57:.5,.4,immediate,at);
    this._ramp(this.layers.bass.gain,menu?.30:.6,.4,immediate,at);
    this._ramp(this.layers.theme.gain,menu?.5:.65,.4,immediate,at);
    this._ramp(this.layers.answer.gain,menu?0:.14+i*.25,.5,immediate,at);
    this._ramp(this.layers.arp.gain,menu?.20:.16+i*.4,.5,immediate,at);
    this._ramp(this.layers.drums.gain,menu?0:.26+i*.4,.5,immediate,at);
  }
  _duckMusic(at,duration){
    if(!this.musicDuck)return;
    this._ramp(this.musicDuck.gain,.52,.025,false,at);
    this.musicDuck.gain.setValueAtTime(.52,at+duration);
    this.musicDuck.gain.linearRampToValueAtTime(1,at+duration+.35);
  }
  _startScheduler(){
    if(this.timer!==null||this.destroyed||this.muted||!this.musicEnabled||!this.context||this.context.state!=='running'||!['battle','menu'].includes(this.scene))return;
    this.nextStepTime=Math.max(this.nextStepTime,this.context.currentTime+.04);
    this._schedule();
    this.timer=setInterval(()=>this._schedule(),50);
  }
  _stopScheduler(){if(this.timer!==null)clearInterval(this.timer);this.timer=null;}
  _schedule(){
    if(this.destroyed||!this.context||this.context.state!=='running'||this.muted||!this.musicEnabled||!ACTIVE_SCENES.has(this.scene))return;
    const now=this.context.currentTime;
    // A throttled background tab never catches up a backlog in one loud burst.
    if(this.nextStepTime<now-.2)this.nextStepTime=now+.04;
    while(this.nextStepTime<now+.18){this._musicStep(this.step++,this.nextStepTime);this.nextStepTime+=EIGHTH;}
  }
  _musicStep(step,at){
    const bar=Math.floor(step/8)%16,section=Math.floor(step/128)%4,beat=step%8,score=SCORE[section],chord=score.chords[bar],root=score.roots[bar],eighth=EIGHTH;
    if(beat===0&&this.pendingScene){
      this.musicScene=this.pendingScene;this.pendingScene=null;
      this.stats.transitions++;this._updateGains(false,at);
      // A soft wood/metal pickup belongs to music and obeys its switch.
      this._tone(at,midi(root+12),.65,.10,{kind:'music',layer:'bass',attack:.025});
      if(this.musicScene==='battle')this._noise(at,.32,.045,{kind:'music',layer:'drums',filter:'lowpass',frequency:1600});
    }
    const menu=this.musicScene==='menu',density=score.density,critical=this.energy==='critical',engaged=this.energy!=='calm';
    const tone=(note,duration,gain,layer,options={})=>this._tone(at,midi(note),duration,gain,{kind:'music',layer,...options});
    if(beat===0){
      chord.forEach((n,k)=>tone(n,8*eighth+.08,.075,'pad',{type:'triangle',attack:.22,release:.26,pan:(k-1)*.38,cutoff:menu?900:1450}));
      tone(root,menu?6*eighth:3.6*eighth,.22,'bass',{type:'sine',attack:.02,release:.13});
    }
    if(beat===4&&!menu)tone(root,3.6*eighth,.17,'bass',{type:'triangle',attack:.012,release:.15,cutoff:430});
    const melody=score.theme[bar][beat];
    if(melody!==null&&(!menu||bar%4!==3&&beat%2===0)&&!(section===0&&bar<8&&beat%2)){
      const next=score.theme[bar][beat+1],duration=(next===null?1.8:.85)*eighth;
      tone(melody-(menu?12:0),duration,.105,'theme',{type:'triangle',attack:menu?.035:.018,release:.12,cutoff:menu?1300:2300,pan:.10});
      // Quiet octave overtone, rather than a harsh full-volume saw lead.
      if(!menu)tone(melody-12,duration,.025,'theme',{type:'sawtooth',attack:.035,release:.10,cutoff:1100,pan:-.10});
    }
    if((menu?beat===0||beat===4:engaged||beat%2===0)&&this.intensity>.08){
      const n=chord[[0,1,2,1,0,2,1,2][beat]]+12;
      tone(n,.19,.055*density,'arp',{type:'sine',attack:.004,release:.12,pan:beat%2?.4:-.4});
    }
    if(menu)return;
    // The Crossing leaves air even at high energy; the final reprise answers
    // the melody with a lower, filtered reed on alternate bars.
    if(section===3&&bar%2===1&&(beat===0||beat===4))tone(chord[beat===0?2:1]+12,3.5*eighth,.07,'answer',{type:'triangle',attack:.06,release:.2,cutoff:1400,pan:-.18});
    if(beat===0||(beat===4&&engaged)||(critical&&density>.7&&(beat===3||beat===7))){
      this._tone(at,105,.30,beat===0?.28:.20,{kind:'music',layer:'drums',type:'sine',end:39,attack:.003});
      this._noise(at,.045,.045,{kind:'music',layer:'drums',filter:'lowpass',frequency:700});
    }
    if((beat===2||beat===6)&&engaged){
      this._noise(at,.13,.13*density,{kind:'music',layer:'drums',filter:'bandpass',frequency:1400,q:.7,pan:beat===2?-.16:.16});
      this._tone(at,180,.10,.09,{kind:'music',layer:'drums',type:'triangle',end:90});
    }
    if(engaged&&(critical||beat%2===1)&&density>.5)this._noise(at,.045,.027,{kind:'music',layer:'drums',filter:'highpass',frequency:5100,pan:beat%2?.3:-.3});
    if(bar%4===3&&beat===7&&critical)this._noise(at+eighth*.5,.09,.075,{kind:'music',layer:'drums',filter:'bandpass',frequency:1100});
  }
  _voiceCount(kind){let count=0;for(const voice of this.voices)if(voice.kind===kind)count++;return count;}
  _output(kind,layer){return kind==='music'?(this.layers[layer]||this.layers.theme):this.sfx;}
  _track(source,gain,nodes,kind,stopAt){
    const voice={source,gain,nodes,kind};
    this.voices.add(voice);
    this.stats.peakVoices=Math.max(this.stats.peakVoices,this.voices.size);
    source.onended=()=>{for(const node of nodes){try{node.disconnect();}catch{}}this.voices.delete(voice);};
    source.stop(stopAt);
    if(kind==='music')this.stats.musicNotes++;
  }
  _envelope(gain,at,duration,peak,attack=.005,release=.05){
    const a=Math.min(attack,duration*.35),r=Math.min(release,duration*.5);
    gain.gain.setValueAtTime(EPSILON,at);
    gain.gain.linearRampToValueAtTime(Math.max(EPSILON,peak),at+a);
    gain.gain.exponentialRampToValueAtTime(Math.max(EPSILON,peak*.65),at+Math.max(a,duration-r));
    gain.gain.exponentialRampToValueAtTime(EPSILON,at+duration);
  }
  _tone(at,frequency,duration,volume,{kind='sfx',layer='theme',type='sine',end=null,attack=.005,release=.06,pan=0,cutoff=0}={}){
    if(!this.context||this.voices.size>=80||kind==='music'&&this._voiceCount('music')>=56)return;
    const c=this.context,source=c.createOscillator(),gain=c.createGain(),nodes=[source,gain];
    source.type=type;source.frequency.setValueAtTime(frequency,at);
    if(end!==null)source.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);
    this._envelope(gain,at,duration,volume,attack,release);
    let output=source;
    if(cutoff){const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=cutoff;filter.Q.value=.5;output.connect(filter);nodes.push(filter);output=filter;}
    output.connect(gain);output=gain;
    if(pan&&c.createStereoPanner){const panner=c.createStereoPanner();panner.pan.value=pan;output.connect(panner);nodes.push(panner);output=panner;}
    output.connect(this._output(kind,layer));
    source.start(at);this._track(source,gain,nodes,kind,at+duration+.02);
  }
  _noise(at,duration,volume,{kind='sfx',layer='drums',filter='lowpass',frequency=1200,end=null,q=.7,pan=0}={}){
    if(!this.context||this.voices.size>=80||kind==='music'&&this._voiceCount('music')>=56)return;
    const c=this.context,source=c.createBufferSource(),gain=c.createGain(),shape=c.createBiquadFilter(),nodes=[source,gain,shape];
    source.buffer=this.noiseBuffer;shape.type=filter;shape.frequency.setValueAtTime(frequency,at);shape.Q.value=q;
    if(end!==null)shape.frequency.exponentialRampToValueAtTime(Math.max(40,end),at+duration);
    this._envelope(gain,at,duration,volume,.003,Math.min(duration*.8,.3));
    source.connect(shape);shape.connect(gain);let output=gain;
    if(pan&&c.createStereoPanner){const panner=c.createStereoPanner();panner.pan.value=pan;output.connect(panner);nodes.push(panner);output=panner;}
    output.connect(this._output(kind,layer));
    source.start(at);this._track(source,gain,nodes,kind,at+duration+.02);
  }
  _stopVoices(kind,fade){
    if(!this.context)return;
    const now=this.context.currentTime;
    for(const voice of [...this.voices])if(kind===null||voice.kind===kind){
      try{voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(Math.max(EPSILON,voice.gain.gain.value),now);voice.gain.gain.linearRampToValueAtTime(EPSILON,now+fade);voice.source.stop(now+fade+.005);}catch{}
      // Closed or test contexts need not emit onended; do not retain their nodes.
      if(fade===0){for(const node of voice.nodes){try{node.disconnect();}catch{}}this.voices.delete(voice);}
    }
  }
}
