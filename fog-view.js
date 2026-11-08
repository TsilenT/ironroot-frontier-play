/** Observation-only presentation boundary for the experimental fog candidate. */
import { Renderer } from './render.js';
import { BattleVFX } from './vfx.js';
import { buildBounds } from './engine.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Each internally owned mask keeps only the last exact raster inputs, never a
// Game, observation or observer reference. A lost mask cannot become a hit.
function maskRaster(mask) {
  const cache = { inputs: null, observers: [], lost: false };
  const invalidate = () => { cache.inputs = null; cache.observers = []; };
  mask.addEventListener?.('contextlost', () => { cache.lost = true; invalidate(); });
  mask.addEventListener?.('contextrestored', () => { cache.lost = false; invalidate(); });
  return cache;
}
function sameMaskRaster(cache, inputs, observers) {
  if (!cache?.inputs || cache.lost || cache.inputs.length !== inputs.length || !cache.inputs.every((value, i) => Object.is(value, inputs[i])) || cache.observers.length !== observers.length * 3) return false;
  return observers.every((o, i) => Object.is(cache.observers[i * 3], o.x) && Object.is(cache.observers[i * 3 + 1], o.y) && Object.is(cache.observers[i * 3 + 2], o.radius));
}
export function memoryLabel(view, memory) {
  const seconds = Math.floor(memory.observedAt), time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const name = view.buildings[memory.type]?.name || 'Building';
  return { title: `${name} · L${memory.level}`, when: `Last seen ${time}`,
    description: `Last seen ${name}, level ${memory.level}, at ${time}. Current health and production unknown.` };
}
const orderedMemories = view => [...view.fog.memories].sort((a, b) => a.lane - b.lane || a.x - b.x || a.y - b.y || a.id - b.id);
const intersects = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
/** No displaced labels: omit a crowded badge, never its true-position marker. */
export function layoutMemoryBadges(view, { width, height, scale, project, measure }) {
  const glyphs = orderedMemories(view).map(memory => {
    const p = project(memory.x, memory.y), w = Math.max(26, 70 * scale), h = Math.max(24, 70 * scale);
    return { memory, p, w, h, rect: { x: p.x - w / 2, y: p.y - h, width: w, height: h }, label: memoryLabel(view, memory), badge: null };
  }).filter(g => intersects(g.rect, { x: 0, y: 0, width, height }));
  const admitted = [];
  for (const glyph of glyphs) {
    const { p, label } = glyph;
    const w = Math.max(measure(label.title, true), measure(label.when, false)) + 12;
    const badge = { x: p.x - w / 2, y: p.y + 3, width: w, height: 29 };
    // Keep clear of the existing top HUD, right tools and lower map controls.
    // A short field intentionally falls back to the semantic Pause details.
    if (badge.x < 4 || badge.x + w > width - 64 || badge.y < 84 || badge.y + badge.height > height - 90) continue;
    if (glyphs.some(g => intersects(badge, g.rect, 2)) || admitted.some(b => intersects(badge, b, 3))) continue;
    glyph.badge = badge; admitted.push(badge);
  }
  return glyphs;
}
/** Only the text may shift; crowded/off-camera citadels retain their true marker. */
export function layoutCitadelLabels(view, base, { width, height, scale, project, measure }) {
  const p = project(base.x, base.y);
  if (p.x < 0 || p.x > width) return null;
  const remembered = view.fog.rememberedCitadel?.choice;
  const labels = ['ENEMY CITADEL', 'HEALTH UNKNOWN', ...(remembered ? [`LAST SEEN: ${remembered === 'arrows' ? 'EXTRA ARROW' : 'REGEN'}`] : [])];
  const font = Math.max(15, 12 / scale), lineHeight = Math.max(29, font * 1.4);
  const w = Math.max(...labels.map(text => measure(text, font, true))) * scale + 8;
  // Match the memory badges' conservative HUD/tools/map clearances. Include
  // the whole last-seen line and font ascent/descent, not just its baseline.
  if (w > width - 68) return null;
  const x = clamp(p.x, 4 + w / 2, width - 64 - w / 2);
  const top = p.y + (75 - font) * scale - 2;
  const bottom = p.y + (75 + (labels.length - 1) * lineHeight + font / 4) * scale + 2;
  const rect = { x: x - w / 2, y: top, width: w, height: bottom - top };
  if (top < 84 || bottom > height - 90) return null;
  // Existing memory placement wins: never move or suppress a stale badge.
  const glyphs = view.fog.memories.length ? layoutMemoryBadges(view, { width, height, scale, project,
    measure: (text, bold) => measure(text, 11, bold) }) : [];
  if (glyphs.some(g => intersects(rect, g.rect, 2) || (g.badge && intersects(rect, g.badge, 2)))) return null;
  return { labels, font, lineHeight, x: (x - p.x) / scale, rect };
}
export function pointInObservation(view, x, y) {
  return !view.fog.enabled || view.fog.observers.some(o => Math.hypot(x - o.x, y - o.y) <= o.radius + 1e-8);
}

/** No callback, reference or inherited method may lead back to the engine. */
export function observationFacade(observation) {
  if (!observation?.fog || !Array.isArray(observation.fog.observers)) throw new Error('A side observation is required.');
  const view = { ...observation };
  view.canBuild = (type, x, y, side = view.fog.side) => {
    const no = reason => ({ ok: false, reason });
    const s = view.state, d = view.buildings[type], bounds = buildBounds(view.map, side);
    if (side !== view.fog.side || !d) return no('Choose one of your buildings.');
    if (s.winner !== null) return no('The battle has ended.');
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return no('Build within your territory.');
    if (s.buildings.some(b => b.hp > 0 && Math.hypot(b.x - x, b.y - y) < 108)) return no('Too close to another building.');
    const own = s.buildings.filter(b => b.side === side);
    if (type === 'mint' && own.filter(b => b.type === 'mint').length >= 3) return no('Maximum 3 gold mines per side.');
    if (s.gold[side] < d.cost) return no(`Need ${d.cost} gold.`);
    if (own.length >= view.map.buildLimit) return no(`Building limit reached (${view.map.buildLimit}).`);
    return { ok: true };
  };
  return view;
}

export function observationHUD(view) {
  const s = view.state, side = view.fog.side, home = s.bases[side], enemy = s.bases[1 - side];
  const visibleEnemies = s.units.filter(u => u.side !== side).length;
  const memoryDetails = view.fog.enabled ? orderedMemories(view).map(m => `${memoryLabel(view, m).description} Road ${m.lane + 1}, position ${Math.round(m.x)} along the known map.`) : [];
  const remembered = view.fog.rememberedCitadel;
  // Keep omitted world text available in Pause, but never turn a current
  // contact into a constantly changing last-seen entry. Use no private state.
  if (view.fog.enabled && !Number.isFinite(enemy.hp) && remembered && !Array.isArray(remembered)
      && ['arrows', 'regen'].includes(remembered.choice) && Number.isFinite(remembered.observedAt)
      && remembered.observedAt >= 0 && remembered.observedAt <= s.time) {
    const seconds = Math.floor(remembered.observedAt), time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    memoryDetails.push(`Last seen enemy citadel with ${remembered.choice === 'arrows' ? 'Extra Arrow' : 'Regeneration'} at ${time}. Current health and upgrade unknown.`);
  }
  return {
    gold: Math.floor(s.gold[side]), income: s.income[side], cooldown: Math.ceil(s.spellCooldown[side]),
    homeHP: Math.ceil(home.hp), enemyHP: Number.isFinite(enemy.hp) ? Math.ceil(enemy.hp) : null,
    ownTroops: s.units.filter(u => u.side === side).length, visibleEnemies,
    memoryDetails,
    memories: view.fog.memories.length, frontX: view.fog.frontX,
    time: `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`,
    description: `${view.fog.enabled ? 'Fog on. Known terrain.' : 'Fog off.'} ${s.units.filter(u => u.side === side).length} allied troops; ${visibleEnemies} ${view.fog.enabled ? 'currently visible ' : ''}enemy troops. ${view.fog.memories.length} last-seen buildings. Enemy citadel health ${Number.isFinite(enemy.hp) ? Math.ceil(enemy.hp) : 'unknown'}. ${view.fog.memories.map(m => memoryLabel(view, m).description).join(' ')}`.trim(),
  };
}

/** Keep only short-lived event identities; never replay an off-camera event. */
export class ObservationAudio {
  constructor({ ownCommandSounds = true } = {}) { this.seen = new Map(); this.ownCommandSounds = ownCommandSounds; }
  reset() { this.seen.clear(); }
  update(view, { camera, width, scale, paused = false }) {
    const s = view.state, half = width / (2 * scale), sounds = [];
    for (const [id, time] of this.seen) if (s.time - time > 4) this.seen.delete(id);
    const events = [...s.effects, ...s.projectiles];
    for (const event of events) {
      const id = event.eventId;
      if (id === undefined || this.seen.has(id)) continue;
      this.seen.set(id, s.time);
      // The main app already gives immediate feedback for its own paid commands.
      if (!this.ownCommandSounds && event.side === view.fog.side && ['build', 'upgrade', 'sell', 'volley'].includes(event.type)) continue;
      if (paused || s.winner !== null || !pointInObservation(view, event.x, event.y) || Math.abs(event.x - camera) > half + 100) continue;
      const name = { hit: 'sword', blast: 'siege', magic: 'magic', volley: 'strike', death: 'collapse', build: 'build', upgrade: 'upgrade', sell: 'sell', spawn: 'spawn', archer: 'arrow', tower: 'arrow', gryphon: 'gryphon' }[event.type];
      if (name) sounds.push({ name, pan: clamp((event.x - camera) / half, -1, 1), volume: event.type === 'death' && event.radius < 30 ? 0.18 : 0.42 });
    }
    const base = s.bases[view.fog.side];
    return { sounds, intensity: Math.min(1, 0.2 + s.units.length / 160 + (s.overtime ? 0.25 : 0) + (base.hp / base.maxHp < 0.35 ? 0.2 : 0)) };
  }
}

/** Preserve event identity for stock VFX and discard particles after loss of sight. */
class ObservedVFX extends BattleVFX {
  constructor(options) { super(options); this.events = new Map(); this.observation = null; }
  reset() { super.reset(); this.events?.clear(); }
  emit(event) {
    const first = this.particles.length;
    super.emit(event);
    for (const particle of this.particles.slice(first)) particle.observedSource = { x: event.x, y: event.y };
  }
  update(effects, dt, options) {
    const view = this.observation;
    if (!view) return;
    for (const [id, entry] of this.events) if (view.state.time - entry.at > 4) this.events.delete(id);
    const stable = effects.filter(e => e.eventId !== undefined).map(e => {
      let entry = this.events.get(e.eventId);
      if (!entry) { entry = { event: { ...e }, at: view.state.time }; this.events.set(e.eventId, entry); }
      else Object.assign(entry.event, e);
      return entry.event;
    });
    super.update(stable, dt, options);
    if (view.fog.enabled) {
      this.particles = this.particles.filter(p => pointInObservation(view, p.x, p.y) && p.observedSource && pointInObservation(view, p.observedSource.x, p.observedSource.y));
      // A previous impact must not keep shaking the camera after sight is lost.
      this.shakeEnergy = 0; this.shake = { x: 0, y: 0 };
    }
  }
}

export class FogRenderer extends Renderer {
  constructor(canvas, minimap) {
    super(canvas, minimap);
    this.vfx = new ObservedVFX({ reducedMotion: this.reducedMotion, quality: 'low' });
    this.mask = document.createElement('canvas');
    this.miniMask = document.createElement('canvas');
    this.maskRaster = maskRaster(this.mask);
    this.miniMaskRaster = maskRaster(this.miniMask);
  }
  invalidateMasks() {
    // Renderer calls the virtual resize during super(), before these exist.
    for (const cache of [this.maskRaster, this.miniMaskRaster]) {
      if (cache) { cache.inputs = null; cache.observers = []; }
    }
  }
  resize() { super.resize(); this.invalidateMasks(); }
  resetObservation() { this.vfx.reset(); this.rootwardenMotion.clear(); this.invalidateMasks(); }
  draw(view, ui, dt) {
    if (!view?.fog || typeof view.canBuild !== 'function') throw new Error('Renderer accepts an observation façade only.');
    // Includes ordinary rendering and the genuine terminal reveal. The app's
    // battle/restore reset path also calls resize(), even at unchanged sizes.
    if (!view.fog.enabled) this.invalidateMasks();
    this.activeGame = view; this.buildings = view.buildings; this.units = view.units;
    this.vfx.observation = view;
    const safeUI = { ...ui, selected: view.state.buildings.some(b => b.side === view.fog.side && b.id === ui.selected) ? ui.selected : null };
    super.draw(view, safeUI, dt);
    if (view.fog.enabled) {
      this.drawMask(this.c, this.mask, this.width, this.height, view, false);
      this.drawChartedTargets(view, safeUI.chartedTargets, false);
      this.drawMemories(view, false);
      if (safeUI.spell && safeUI.pointer && !pointInObservation(view, safeUI.pointer.x, safeUI.pointer.y)) {
        const p = this.worldToScreen(safeUI.pointer.x, safeUI.pointer.y), c = this.c;
        c.save(); c.strokeStyle = '#ffd0b7'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(p.x - 9, p.y - 9); c.lineTo(p.x + 9, p.y + 9); c.moveTo(p.x + 9, p.y - 9); c.lineTo(p.x - 9, p.y + 9); c.stroke(); c.restore();
      }
    }
  }
  drawBase(base, view) {
    const c = this.c;
    if (!Number.isFinite(base.hp)) {
      c.save(); c.translate(base.x, base.y); c.strokeStyle = '#ded3bb'; c.fillStyle = '#b1ad9e';
      c.lineWidth = 3; c.setLineDash([8, 6]); c.strokeRect(-57, -88, 114, 125); c.setLineDash([]);
      c.fillRect(-62, -99, 24, 20); c.fillRect(38, -99, 24, 20);
      const label = layoutCitadelLabels(view, base, { width: this.width, height: this.height, scale: this.scale,
        project: (x, y) => this.worldToScreen(x, y),
        measure: (text, size, bold) => { c.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; return c.measureText(text).width; } });
      if (label) {
        c.textAlign = 'center'; c.font = `bold ${label.font}px sans-serif`; c.fillStyle = '#fff4df';
        label.labels.forEach((text, i) => c.fillText(text, label.x, 75 + i * label.lineHeight));
      }
      c.restore();
      return;
    }
    // Own upgrades use the shared badge/picking geometry, but only the detached
    // own observation. Enemy rendering never receives private status helpers.
    if (base.side === view.fog.side) {
      super.drawBase(base, view);
      return;
    }
    // The stock status helper expects private timers and counters. Never give it
    // a partial enemy record, even while that enemy citadel is visible.
    super.drawBase(base, null);
    const choice = view.state.citadelOptions?.sides?.[base.side]?.choice;
    if (choice) {
      c.save(); c.textAlign = 'center'; c.fillStyle = '#fff0c7'; c.font = `bold ${Math.max(14, 11 / this.scale)}px sans-serif`;
      c.fillText(choice === 'arrows' ? 'EXTRA ARROW' : 'REGENERATION', base.x, base.y + 112); c.restore();
    }
  }
  drawMask(c, mask, width, height, view, mini) {
    const w = Math.max(1, Math.round(width * this.dpr)), h = Math.max(1, Math.round(height * this.dpr));
    const cache = mask === this.mask ? this.maskRaster : mask === this.miniMask ? this.miniMaskRaster : null;
    if (mask.width !== w || mask.height !== h) {
      mask.width = w; mask.height = h;
      if (cache) cache.inputs = null;
    }
    const m = mask.getContext('2d'), observers = view.fog.observers;
    const inputs = [mini, width, height, w, h, this.dpr, view.fog.side, view.fog.enabled, view.fog.revealed, view.map.width, view.map.height,
      ...(mini ? [] : [this.width, this.height, this.camera, this.scale])];
    const lost = cache?.lost || m.isContextLost?.();
    if (lost || !sameMaskRaster(cache, inputs, observers)) {
      m.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); m.clearRect(0, 0, width, height);
      m.globalCompositeOperation = 'source-over'; m.fillStyle = '#102522a6'; m.fillRect(0, 0, width, height);
      m.globalCompositeOperation = 'destination-out'; m.fillStyle = '#000';
      for (const o of observers) {
        const p = mini ? { x: o.x / view.map.width * width, y: o.y / view.map.height * height } : this.worldToScreen(o.x, o.y);
        m.beginPath();
        if (mini) m.ellipse(p.x, p.y, o.radius / view.map.width * width, o.radius / view.map.height * height, 0, 0, Math.PI * 2);
        else m.arc(p.x, p.y, o.radius * this.scale, 0, Math.PI * 2);
        m.fill();
      }
      m.globalCompositeOperation = 'source-over';
      if (cache) {
        cache.inputs = lost ? null : inputs;
        cache.observers = lost ? [] : observers.flatMap(o => [o.x, o.y, o.radius]);
      }
    }
    // Reusing raster pixels never skips compositing onto the fresh frame.
    c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.drawImage(mask, 0, 0, width, height); c.restore();
  }
  drawMemories(view, mini) {
    const c = mini ? this.m : this.c;
    c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (mini) {
      for (const b of view.fog.memories) {
        const p = { x: b.x / view.map.width * this.mw, y: b.y / view.map.height * this.mh };
        c.strokeStyle = '#d4cec0'; c.fillStyle = '#182a29db'; c.lineWidth = 1; c.setLineDash([2, 2]);
        c.fillRect(p.x - 3, p.y - 6, 6, 6); c.strokeRect(p.x - 3, p.y - 6, 6, 6);
      }
    } else {
      const glyphs = layoutMemoryBadges(view, { width: this.width, height: this.height, scale: this.scale,
        project: (x, y) => this.worldToScreen(x, y), measure: (text, bold) => { c.font = `${bold ? 'bold ' : ''}11px sans-serif`; return c.measureText(text).width; } });
      for (const { memory: b, p, w, h } of glyphs) {
        c.strokeStyle = '#d4cec0'; c.fillStyle = '#182a29db'; c.lineWidth = 1.5; c.setLineDash([4, 3]);
        c.fillRect(p.x - w / 2, p.y - h, w, h); c.strokeRect(p.x - w / 2, p.y - h, w, h); c.setLineDash([]);
        c.fillStyle = '#ece6d6'; c.textAlign = 'center'; c.font = 'bold 10px sans-serif';
        c.fillText(`${(view.buildings[b.type]?.short || '?').slice(0, 2).toUpperCase()}${b.level}`, p.x, p.y - h / 2 + 4, w - 4);
      }
      // All glyph footprints were reserved first, including later-painted ones.
      for (const { label, badge } of glyphs) {
        if (!badge) continue;
        const x = badge.x + badge.width / 2;
        c.fillStyle = '#122720f2'; c.fillRect(badge.x, badge.y, badge.width, badge.height);
        c.font = 'bold 11px sans-serif'; c.fillStyle = '#f3ead7'; c.fillText(label.title, x, badge.y + 12);
        c.font = '11px sans-serif'; c.fillStyle = '#d1d9c9'; c.fillText(label.when, x, badge.y + 25);
      }
    }
    c.restore();
  }
  /** Authored map symbols, never buildings or synthetic last-seen records. */
  drawChartedTargets(view, targets, mini) {
    // Preserve existing fog output and raster/memory work when no chart exists.
    if (!Array.isArray(targets) || !targets.length) return;
    const markers = targets.filter(target => !target.confirmedDestroyed && target.status !== 'destroyed'
      && !view.state.buildings.some(b => b.id === target.originalId)
      && Number.isFinite(target.x) && Number.isFinite(target.y)
      && target.x >= 0 && target.x <= view.map.width && target.y >= 0 && target.y <= view.map.height);
    if (!markers.length) return;
    const c = mini ? this.m : this.c;
    c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.setLineDash([]);
    for (const target of markers) {
      const p = mini ? { x: target.x / view.map.width * this.mw, y: target.y / view.map.height * this.mh }
        : this.worldToScreen(target.x, target.y);
      // Sit above the true site, clear of its possible stale-building glyph.
      // Names and health-unknown text belong in the stable DOM focus cards.
      const x = p.x, y = mini ? p.y : p.y - Math.max(24, 70 * this.scale) - 13, r = mini ? 5 : 10;
      if (!mini && (x + r < 0 || x - r > this.width || y + r < 0 || y - r > this.height)) continue;
      c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
      c.strokeStyle = '#122720'; c.lineWidth = mini ? 3 : 4; c.stroke();
      c.strokeStyle = '#f1d295'; c.lineWidth = mini ? 1.25 : 1.75; c.stroke();
      // A folded-chart glyph makes the hollow diamond distinct from a live
      // objective's filled diamond and a memory's dashed building rectangle.
      const u = mini ? .45 : .9;
      c.beginPath(); c.moveTo(x - 4 * u, y - 3 * u); c.lineTo(x - u, y - 4 * u);
      c.lineTo(x + u, y - 2 * u); c.lineTo(x + 4 * u, y - 3 * u);
      c.lineTo(x + 4 * u, y + 3 * u); c.lineTo(x + u, y + 4 * u);
      c.lineTo(x - u, y + 2 * u); c.lineTo(x - 4 * u, y + 3 * u); c.closePath();
      c.moveTo(x - u, y - 4 * u); c.lineTo(x - u, y + 2 * u);
      c.moveTo(x + u, y - 2 * u); c.lineTo(x + u, y + 4 * u); c.stroke();
    }
    c.restore();
  }
  drawMinimap(state, view, ui) {
    super.drawMinimap(state, view, ui);
    if (!view.fog.enabled) return;
    this.drawMask(this.m, this.miniMask, this.mw, this.mh, view, true);
    this.drawMemories(view, true);
    this.drawChartedTargets(view, ui.chartedTargets, true);
    const width = Math.min(this.mw, this.width / this.scale / view.map.width * this.mw), x = this.camera / view.map.width * this.mw - width / 2;
    this.m.save(); this.m.strokeStyle = '#fff5ce'; this.m.lineWidth = 1.5; this.m.strokeRect(x + .75, .75, width - 1.5, this.mh - 1.5); this.m.restore();
  }
}
