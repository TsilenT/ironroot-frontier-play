import { drawRootwarden, drawWardenLodge } from './rootwarden-art.js';
import { sampleCombatFeedback } from './combat-feedback.js';
import { BattleVFX } from './vfx.js';
import { drawFlightRoutes, drawFlightLabels, drawFlightMinimap } from './flight-visuals.js';
import {
  BUILDINGS,
  UNITS,
  SPELL,
  getMap,
  buildSites,
  buildBounds,
  homeX,
  worldX,
} from './engine.js';
const COLORS = [
  { cloth: '#539d95', bright: '#b4e3c3', dark: '#214d4a', flag: '#80c5ad' },
  { cloth: '#ad6554', bright: '#edbb92', dark: '#683e35', flag: '#d59070' },
];
export const icons = {
  wardenLodge: '<path d="M7 39V20L23 7l16 13v19z" fill="#818f77"/><path d="m3 21 20-17 20 17-6 4-14-12L9 25z" fill="#b4bda0"/><path d="m16 26 7-5 7 5v9l-7 5-7-5z" fill="#507e71"/><path d="M23 25v11" stroke="#dbc58d" stroke-width="3"/>',
  barracks:
    '<path d="M7 19 23 8l16 11v20H7z" fill="#a1ae83"/><path d="m3 20 20-15 20 15-5 4-15-11L8 25z" fill="#d0b27d"/><path d="M18 28h10v11H18z" fill="#314332"/><path d="M11 5v10M35 5v10" stroke="#e6d2a1" stroke-width="3"/>',
  archery:
    '<path d="M9 39V18l14-9 14 9v21z" fill="#7eaa89"/><path d="m5 20 18-15 18 15-5 4-13-11-13 11z" fill="#aec5a0"/><circle cx="23" cy="27" r="8" fill="#e7c791"/><circle cx="23" cy="27" r="5" fill="#9d664d"/><circle cx="23" cy="27" r="2" fill="#e3cc96"/>',
  foundry:
    '<path d="M7 19h31v20H7z" fill="#c79c6f"/><path d="M28 6h8v17h-8z" fill="#9c8771"/><path d="m4 20 13-11 15 11z" fill="#a2644b"/><path d="M12 39V29a6 6 0 0 1 12 0v10" fill="#3c3d2c"/><path d="m14 36 4-9 4 9" fill="#edaf63"/>',
  watchtower:
    '<path d="m12 39 4-27h16l4 27z" fill="#9fac9c"/><path d="M11 9h6v5h5V9h5v5h5V9h5v13H11z" fill="#c3c9ac"/><path d="M21 29h7v10h-7z" fill="#3b5144"/><path d="M16 26h6M28 23h5" stroke="#798c7a" stroke-width="2"/>',
  sanctum:
    '<path d="M10 40V22l13-9 13 9v18z" fill="#a0a58c"/><path d="m6 23 17-18 17 18z" fill="#8a75a1"/><path d="m23 3 7 10-7 9-7-9z" fill="#d5b7ec"/><path d="M19 40V29h8v11" fill="#4b4662"/>',
  aerie:
    '<path d="m14 40 4-20h11l5 20z" fill="#9c9e83"/><ellipse cx="24" cy="19" rx="19" ry="10" fill="#b49969"/><path d="m7 16 10 10 21-9M10 23 23 12l14 11" fill="none" stroke="#dbbc7e" stroke-width="3"/><path d="m22 21-12-7-5-8 15 6 4-8 5 9 13-7-5 11-10 7z" fill="#ead4a3"/>',
  mint: '<path d="m4 39 4-16 13-12 19 9 3 19z" fill="#8b9980"/><path d="M12 39V28a11 11 0 0 1 22 0v11" fill="#2b3a2d"/><path d="M11 21h24v5H11zM12 25v14M34 25v14" stroke="#c3a16c" stroke-width="4"/><path d="m17 34 4-4 5 3 4-3 4 7H16z" fill="#e8c769"/>',
};
export const iconSVG = (t) =>
  `<svg viewBox="0 0 46 46" aria-hidden="true">${icons[t] || icons.barracks}</svg>`;
function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function poly(c, pts, color, outline = 0) {
  c.fillStyle = color;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  if (outline) outlinePath(c, outline);
  c.fill();
}
function ellipse(c, x, y, rx, ry, color, outline = 0) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (outline) outlinePath(c, outline);
  c.fill();
}
function outlinePath(c, width) {
  c.save();
  c.strokeStyle = '#182a26';
  c.lineWidth = width * 2;
  c.lineJoin = 'round';
  c.stroke();
  c.restore();
}

/** Presentation only. Never use this enlargement for hits, ranges or placement. */
export function battlefieldReadability(scale = 1) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    unitScale: Math.max(1, Math.min(1.65, 0.55 / safeScale)),
    compact: Math.max(0, Math.min(1, (0.65 - safeScale) / 0.33)),
  };
}
function line(c, pts, color, width = 1) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
}
function tree(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  ellipse(c, 10, 9, 22, 9, '#334a3538');
  c.fillStyle = '#554f38';
  c.fillRect(-3, -4, 6, 18);
  poly(
    c,
    [
      [-20, -2],
      [0, -36],
      [20, -2],
    ],
    '#374f3d',
  );
  poly(
    c,
    [
      [-17, -14],
      [0, -47],
      [17, -14],
    ],
    '#415f44',
  );
  poly(
    c,
    [
      [-12, -28],
      [0, -54],
      [12, -28],
    ],
    '#52714c',
  );
  line(
    c,
    [
      [0, -48],
      [0, -2],
    ],
    '#60794e',
    1,
  );
  c.restore();
}
function rock(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  poly(
    c,
    [
      [-11, 1],
      [-7, -9],
      [5, -12],
      [13, -3],
      [9, 7],
      [-5, 8],
    ],
    '#75816b',
  );
  poly(
    c,
    [
      [-7, -9],
      [5, -12],
      [8, -4],
      [-2, 0],
    ],
    '#99a185',
  );
  c.restore();
}
export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.mini = minimap;
    this.c = canvas.getContext('2d');
    this.m = minimap.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.camera = 800;
    this.zoom = 1;
    this.map = getMap('classic');
    this.buildings = BUILDINGS;
    this.units = UNITS;
    this.activeGame = null;
    this.theme = 'woodland';
    this.terrain = this.makeTerrain();
    this.baseTerrain = this.terrain;
    this.terrainKey = this.map.id + ':' + this.map.revision + ':' + this.theme;
    this.resize();
    this.time = 0;
    this.rootwardenMotion = new Map();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.vfx = new BattleVFX({ reducedMotion: this.reducedMotion });
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.dpr = dpr;
    const mr = this.mini.getBoundingClientRect();
    this.mini.width = Math.round(mr.width * dpr);
    this.mini.height = Math.round(mr.height * dpr);
    this.mw = mr.width;
    this.mh = mr.height;
    this.scale = Math.max(0.32, this.height / this.map.height) * this.zoom;
    this.clampCamera();
  }
  /** Select a registered battlefield before setting the battle's camera. */
  setMap(mapOrId = 'classic') {
    const map = getMap(typeof mapOrId === 'string' ? mapOrId : mapOrId?.id);
    if (typeof mapOrId !== 'string' && mapOrId !== map)
      throw new Error('Use a registered battlefield descriptor.');
    if (map === this.map) return map;
    const oldBase = this.baseTerrain,
      oldTerrain = this.terrain;
    this.map = map;
    this.baseTerrain = this.makeTerrain();
    this.terrain = this.baseTerrain;
    this.terrainKey = null;
    this.releaseTerrain(oldTerrain);
    if (oldBase !== oldTerrain) this.releaseTerrain(oldBase);
    this.setTheme(this.theme);
    this.clampCamera();
    return map;
  }
  releaseTerrain(canvas) {
    // Only the active map's base and active theme retain canvas backing stores.
    if (canvas && canvas !== this.baseTerrain && canvas !== this.terrain) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  setTheme(theme = 'woodland') {
    if (!['woodland', 'highland', 'ashlands', 'citadel'].includes(theme))
      theme = 'woodland';
    const key = this.map.id + ':' + this.map.revision + ':' + theme;
    if (key === this.terrainKey) return;
    const oldTerrain = this.terrain;
    this.theme = theme;
    this.terrainKey = key;
    if (theme === 'woodland') {
      this.terrain = this.baseTerrain;
      this.releaseTerrain(oldTerrain);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.map.width;
    canvas.height = this.map.height;
    const c = canvas.getContext('2d');
    c.filter =
      theme === 'highland'
        ? 'saturate(.48) brightness(1.13)'
        : theme === 'ashlands'
          ? 'sepia(.56) saturate(.72) brightness(.78)'
          : 'saturate(.38) contrast(1.06) brightness(.9)';
    c.drawImage(this.baseTerrain, 0, 0);
    c.filter = 'none';
    const r = rng(
      theme === 'highland' ? 733 : theme === 'ashlands' ? 811 : 919,
    );
    if (theme === 'highland') {
      for (let i = 0; i < 100; i++) {
        const x = r() * this.map.width,
          y = r() < 0.5 ? r() * 150 : 760 + r() * 140;
        ellipse(c, x, y, 10 + r() * 35, 4 + r() * 13, '#d7dcc377');
      }
      c.fillStyle = '#c4d8d51a';
      c.fillRect(0, 0, this.map.width, this.map.height);
    } else if (theme === 'ashlands') {
      for (let i = 0; i < 65; i++) {
        const x = r() * this.map.width,
          y = r() * this.map.height;
        if (this.map.lanes.some((a) => Math.abs(a - y) < 60)) continue;
        line(
          c,
          [
            [x, y],
            [x + 12, y - 8],
            [x + 24, y - 3],
            [x + 31, y - 15],
          ],
          '#b9864b66',
          2,
        );
      }
    } else {
      for (const y of this.map.lanes)
        for (let x = 0; x < this.map.width; x += 54) {
          c.fillStyle = (x / 54) % 2 ? '#b0ad9255' : '#757e6a44';
          c.fillRect(x + 1, y - 35, 51, 33);
          c.fillRect(x - 25, y + 2, 51, 32);
        }
    }
    this.terrain = canvas;
    this.releaseTerrain(oldTerrain);
  }
  clampCamera() {
    const half = this.width / (2 * this.scale),
      middle = this.map.width / 2;
    this.camera =
      half >= middle
        ? middle
        : Math.max(half, Math.min(this.map.width - half, this.camera));
  }
  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.scale + this.camera,
      y: (y - this.height / 2) / this.scale + 450,
    };
  }
  worldToScreen(x, y) {
    return {
      x: (x - this.camera) * this.scale + this.width / 2,
      y: (y - 450) * this.scale + this.height / 2,
    };
  }
  pan(pixels) {
    this.camera -= pixels / this.scale;
    this.clampCamera();
  }
  snap(p, side = 0) {
    // Match Classic pointer/controller ties: later column and higher row win.
    // Occupancy is intentionally not considered: an occupied tap stays occupied.
    const columns = this.map.siteColumns,
      x = Math.max(columns[0], Math.min(columns.at(-1), homeX(this.map, side, p.x)));
    return {
      x: Number.isNaN(x)
        ? NaN
        : worldX(this.map, side, columns.reduce((a, b) =>
          Math.abs(a - x) < Math.abs(b - x) ? a : b,
        )),
      y: this.map.lanes.reduce((a, b) =>
        Math.abs(a - p.y) < Math.abs(b - p.y) ? a : b,
      ),
    };
  }
  makeTerrain() {
    const canvas = document.createElement('canvas');
    canvas.width = this.map.width;
    canvas.height = this.map.height;
    const c = canvas.getContext('2d'),
      r = rng(3182),
      middle = this.map.width / 2;
    c.fillStyle = '#74815a';
    c.fillRect(0, 0, this.map.width, this.map.height);
    for (let i = 0; i < 850; i++) {
      const x = r() * this.map.width,
        y = r() * this.map.height;
      ellipse(
        c,
        x,
        y,
        20 + r() * 95,
        12 + r() * 45,
        ['#687a53', '#7c895f', '#829064', '#5d754f'][Math.floor(r() * 4)],
      );
    }
    const river = (offset, color, width) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(middle - 10 + offset, -100);
      c.bezierCurveTo(
        middle - 150 + offset,
        200,
        middle + 100 + offset,
        380,
        middle - 20 + offset,
        570,
      );
      c.bezierCurveTo(
        middle - 120 + offset,
        720,
        middle + 60 + offset,
        830,
        middle - 10 + offset,
        1000,
      );
      c.stroke();
    };
    river(0, '#566e54', 145);
    river(0, '#496c66', 108);
    river(-10, '#587d71', 60);
    river(13, '#71917d', 3);
    for (const y of this.map.lanes) {
      c.fillStyle = '#657450';
      c.fillRect(0, y - 54, this.map.width, 108);
      c.fillStyle = '#a99f73';
      c.fillRect(0, y - 43, this.map.width, 86);
      c.fillStyle = '#b4a77c';
      c.fillRect(0, y - 31, this.map.width, 62);
      for (let j = 0; j < 140; j++) {
        const x = r() * this.map.width;
        ellipse(
          c,
          x,
          y + (r() - 0.5) * 68,
          3 + r() * 8,
          1 + r() * 2,
          '#8e9064',
        );
      }
      c.strokeStyle = '#bdb189';
      c.lineWidth = 1;
      c.setLineDash([6, 23]);
      c.beginPath();
      c.moveTo(100, y);
      c.lineTo(this.map.width - 100, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#635e48';
      c.fillRect(middle - 108, y - 51, 202, 102);
      for (let x = middle - 106; x < middle + 95; x += 13) {
        c.fillStyle = x % 2 ? '#998a61' : '#ac9b6d';
        c.fillRect(x, y - 47, 11, 94);
      }
      c.fillStyle = '#d0b988';
      c.fillRect(middle - 112, y - 55, 210, 8);
      c.fillRect(middle - 112, y + 47, 210, 8);
      for (let x = middle - 106; x < middle + 100; x += 50) {
        c.fillStyle = '#5b6249';
        c.fillRect(x, y - 65, 8, 20);
        c.fillRect(x, y + 45, 8, 20);
      }
    }
    for (let i = 0; i < 390; i++) {
      const x = r() * this.map.width,
        y = r() * this.map.height;
      if (
        this.map.lanes.some((a) => Math.abs(y - a) < 68) ||
        (x > middle - 140 && x < middle + 120) ||
        x < 190 ||
        x > this.map.width - 190
      )
        continue;
      if (y < 155 || y > 760 || r() < 0.06) tree(c, x, y, 0.7 + r() * 0.8);
      else if (r() < 0.22) rock(c, x, y, 0.6 + r() * 0.7);
      else {
        c.strokeStyle = '#a4ac7444';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - 2, y - 5);
        c.moveTo(x, y);
        c.lineTo(x + 3, y - 7);
        c.stroke();
      }
    }
    // Quiet ruins and border markers give the frontier scale.
    for (const x of [middle - 160, middle + 160])
      for (const y of [125, 775]) {
        rock(c, x, y, 2.5);
        c.fillStyle = '#747f68';
        c.fillRect(x - 8, y - 45, 16, 48);
        c.fillStyle = '#a5a786';
        c.fillRect(x - 12, y - 49, 24, 9);
      }
    for (const x of [
      buildBounds(this.map, 0).maxX + 70,
      buildBounds(this.map, 1).minX - 70,
    ]) {
      c.strokeStyle = '#b9c48b77';
      c.setLineDash([9, 14]);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, 160);
      c.lineTo(x, 740);
      c.stroke();
      c.setLineDash([]);
    }
    return canvas;
  }
  draw(game, ui, dt) {
    if (this.activeGame !== game) {
      this.activeGame = game;
      this.buildings = game.buildings || BUILDINGS;
      this.units = game.units || UNITS;
      this.rootwardenMotion.clear();
    }
    const buildType = typeof ui.build === 'string' && Object.hasOwn(this.buildings, ui.build) ? ui.build : null;
    this.time += ui.paused ? 0 : dt;
    const c = this.c,
      s = game.state;
    this.vfx.update(s.effects, dt, { paused: !!ui.paused });
    const shake = this.vfx.getShake();
    this.clampCamera();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    c.save();
    c.translate(this.width / 2 + shake.x, this.height / 2 + shake.y);
    c.scale(this.scale, this.scale);
    c.translate(-this.camera, -450);
    c.drawImage(this.terrain, 0, 0);
    const { compact } = battlefieldReadability(this.scale);
    // Quiet the baked decoration at small scales without hiding roads or sites.
    if (compact) {
      c.save();
      c.globalAlpha = compact * 0.18;
      c.fillStyle = '#24342c';
      c.fillRect(0, 0, this.map.width, this.map.height);
      c.restore();
    }
    // Subtle side tints on each half.
    c.fillStyle = '#4597800c';
    const frontier = buildBounds(this.map, 0).maxX + 70;
    c.fillRect(0, 150, frontier, 600);
    c.fillStyle = '#a051370b';
    c.fillRect(this.map.width - frontier, 150, frontier, 600);
    if (buildType) {
      for (const { x, y } of buildSites(this.map, 0)) {
        const valid = game.canBuild(buildType, x, y).ok;
        c.fillStyle = valid ? '#c8e2a429' : '#273d2820';
        c.strokeStyle = valid ? '#d0e7a67a' : '#52644733';
        c.lineWidth = Math.max(1.5, 1 / this.scale);
        c.fillRect(x - 55, y - 55, 110, 110);
        c.strokeRect(x - 55, y - 55, 110, 110);
        if (valid) {
          c.strokeStyle = '#d0e7a699';
          const mark = Math.max(7, 3.5 / this.scale);
          c.beginPath();
          c.moveTo(x - mark, y);
          c.lineTo(x + mark, y);
          c.moveTo(x, y - mark);
          c.lineTo(x, y + mark);
          c.stroke();
        }
      }
    }
    const selected = s.buildings.find((b) => b.id === ui.selected);
    if (selected) {
      const d = this.buildings[selected.type];
      if (d.range) {
        c.beginPath();
        c.arc(selected.x, selected.y, d.range, 0, Math.PI * 2);
        c.fillStyle = '#d6e4b315';
        c.fill();
        c.strokeStyle = '#d6e4b399';
        c.setLineDash([7, 9]);
        c.stroke();
        c.setLineDash([]);
      }
      ellipse(c, selected.x, selected.y + 18, 65, 30, '#e8cf8c33');
      c.strokeStyle = '#efd18e';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(selected.x, selected.y + 18, 65, 30, 0, 0, Math.PI * 2);
      c.stroke();
    }
    const left = this.camera - this.width / (2 * this.scale) - 120,
      right = this.camera + this.width / (2 * this.scale) + 120;
    // Impacts read as ground events; troops and objective markers stay on top.
    for (const e of s.effects) this.drawEffect(e);
    this.vfx.draw(c, { x: left, y: 0, width: right - left, height: this.map.height }, { compact: compact > 0 });
    const flightLabels = drawFlightRoutes(this, game, ui);
    this.drawBase(s.bases[0]);
    this.drawBase(s.bases[1]);
    // Presentation-only locomotion from observed simulation positions, never cooldown.
    const wardenIds = new Set();
    for (const u of s.units) if (u.type === 'rootwarden') {
      wardenIds.add(u.id);
      const old = this.rootwardenMotion.get(u.id);
      if (!old || old.time !== s.time) this.rootwardenMotion.set(u.id, {
        x: u.x, y: u.y, time: s.time,
        moving: !!old && Math.hypot(u.x - old.x, u.y - old.y) > 0.001,
      });
    }
    for (const id of this.rootwardenMotion.keys()) if (!wardenIds.has(id)) this.rootwardenMotion.delete(id);
    const entities = [...s.buildings, ...s.units].sort((a, b) => a.y - b.y);
    for (const e of entities) {
      if (e.x < left || e.x > right) continue;
      if (Object.hasOwn(this.buildings, e.type)) this.drawBuilding(e);
      else this.drawUnit(e, s.time);
    }
    for (const p of s.projectiles) {
      const t = 1 - p.life / p.maxLife;
      const arc = p.type === 'siege' ? Math.sin(t * Math.PI) * 55 : 0;
      c.save();
      c.translate(
        p.x,
        p.y -
          arc -
          17 -
          (p.sourceAir ? 17 * (1 - t) : 0) -
          (p.targetAir ? 17 * t : 0),
      );
      if (p.type === 'wizard') {
        ellipse(c, 0, 0, 7, 7, '#bfa0ed66');
        ellipse(c, 0, 0, 4, 4, '#e6cbff');
      } else if (p.type === 'gryphon') {
        line(
          c,
          [
            [-7, -4],
            [5, 1],
          ],
          '#f4dcaa',
          2,
        );
        line(
          c,
          [
            [-7, 1],
            [5, 6],
          ],
          '#f4dcaa',
          2,
        );
      } else if (p.type === 'siege') {
        ellipse(c, 0, 0, 5, 5, '#e8ad69');
        ellipse(c, -2, -2, 2, 2, '#fff0b2');
      } else {
        c.rotate(Math.atan2(p.ty - p.sy, p.tx - p.sx));
        line(
          c,
          [
            [-11, 0],
            [7, 0],
          ],
          p.side ? '#ebbc8a' : '#dae7b6',
          2,
        );
        poly(
          c,
          [
            [8, 0],
            [2, -3],
            [2, 3],
          ],
          '#f3e4b5',
        );
      }
      c.restore();
    }
    // Paths stay below actors; complete route labels clear building pennants.
    drawFlightLabels(this, flightLabels);
    // Mission badges must not disappear behind enlarged troops or projectile trails.
    for (const e of s.buildings) {
      if (e.x < left || e.x > right) continue;
      if (ui.targets?.includes(e.id)) {
        c.save();
        c.translate(e.x, e.y - 94);
        const markerScale = Math.max(1, Math.min(2, 10 / (18 * this.scale)));
        c.scale(markerScale, markerScale);
        const protect = ui.protectedTargets?.includes(e.id);
        poly(
          c,
          [
            [0, -9],
            [9, 0],
            [0, 9],
            [-9, 0],
          ],
          protect ? '#b6ead5' : '#f1d295',
          Math.min(3, 0.75 / (this.scale * markerScale)),
        );
        if (protect)
          poly(
            c,
            [
              [-4, -4],
              [4, -4],
              [4, 2],
              [0, 6],
              [-4, 2],
            ],
            '#376c57',
          );
        else
          poly(
            c,
            [
              [0, -4],
              [4, 0],
              [0, 4],
              [-4, 0],
            ],
            '#69543b',
          );
        c.restore();
      }
    }
    if (ui.pointer && buildType && !ui.dragging) {
      const p = this.snap(ui.pointer);
      const valid = game.canBuild(buildType, p.x, p.y).ok;
      c.save();
      c.globalAlpha = 0.6;
      this.drawBuilding({
        x: p.x,
        y: p.y,
        side: 0,
        type: buildType,
        hp: this.buildings[buildType].hp,
        maxHp: this.buildings[buildType].hp,
        level: 1,
        ghost: true,
      });
      c.globalAlpha = 1;
      c.strokeStyle = valid ? '#edf2b4' : '#e89176';
      c.lineWidth = Math.max(3, 2 / this.scale);
      c.strokeRect(p.x - 55, p.y - 55, 110, 110);
      c.restore();
    }
    if (ui.spell && ui.pointer) {
      c.beginPath();
      c.arc(ui.pointer.x, ui.pointer.y, SPELL.radius, 0, Math.PI * 2);
      c.fillStyle = '#f0d17a25';
      c.fill();
      c.strokeStyle = '#efd491';
      c.lineWidth = 2;
      c.setLineDash([10, 8]);
      c.stroke();
      c.setLineDash([]);
    }
    // World-side labels remain grounded in the scene.
    c.textAlign = 'center';
    c.font = `600 ${Math.max(13, 10 / this.scale)}px "DM Sans",sans-serif`;
    c.fillStyle = '#e5edc2';
    c.fillText('YOUR FRONTIER', 780, 145);
    c.fillStyle = '#f1d5b7';
    c.fillText('ENEMY FRONTIER', this.map.width - 770, 145);
    c.restore();
    const shade = c.createLinearGradient(0, 0, 0, this.height);
    shade.addColorStop(0, '#172b2638');
    shade.addColorStop(0.22, '#14281c00');
    shade.addColorStop(0.8, '#14281c00');
    shade.addColorStop(1, '#1a2b1d4d');
    c.fillStyle = shade;
    c.fillRect(0, 0, this.width, this.height);
    this.drawMinimap(s, game, ui);
  }
  drawBuilding(b) {
    const c = this.c,
      co = COLORS[b.side],
      d = (this.buildings || BUILDINGS)[b.type];
    c.save();
    c.translate(b.x, b.y);
    if (b.type !== 'wardenLodge') ellipse(c, 8, 23, 51, 22, '#233a3045');
    if (b.hit) c.globalAlpha = 0.7;
    const roof = b.side ? '#986652' : '#5d8570',
      roofLight = b.side ? '#bd8663' : '#8cab83';
    if (b.type === 'wardenLodge') {
      drawWardenLodge(c, { side: b.side, compact: battlefieldReadability(this.scale).compact > 0, reducedMotion: this.reducedMotion, state: b.hit ? 'hit' : !b.ghost && b.progress > 0 ? 'working' : 'idle' });
    } else if (b.type === 'sanctum') {
      poly(
        c,
        [
          [-32, 23],
          [-32, -29],
          [0, -47],
          [32, -29],
          [32, 23],
          [0, 38],
        ],
        '#a1ab95',
      );
      poly(
        c,
        [
          [0, -47],
          [32, -29],
          [32, 23],
          [0, 38],
        ],
        '#7c887a',
      );
      poly(
        c,
        [
          [-43, -23],
          [0, -73],
          [43, -23],
          [0, -5],
        ],
        '#82718d',
      );
      poly(
        c,
        [
          [0, -73],
          [43, -23],
          [0, -5],
        ],
        '#a88bab',
      );
      c.fillStyle = '#4d4d66';
      c.fillRect(-9, 6, 18, 24);
      ellipse(c, 0, -72, 20, 10, '#c9a8ef22');
      poly(
        c,
        [
          [0, -103],
          [12, -83],
          [0, -64],
          [-12, -83],
        ],
        '#c8a6ee',
      );
      poly(
        c,
        [
          [0, -103],
          [0, -64],
          [-12, -83],
        ],
        '#ebe1f7',
      );
      c.strokeStyle = '#d4b5ef66';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(0, -82, 23, 9, Math.sin(this.time) * 0.2, 0, Math.PI * 2);
      c.stroke();
    } else if (b.type === 'aerie') {
      poly(
        c,
        [
          [-24, 29],
          [-18, -34],
          [18, -34],
          [26, 29],
          [0, 41],
        ],
        '#8c9780',
      );
      poly(
        c,
        [
          [0, 41],
          [0, -34],
          [18, -34],
          [26, 29],
        ],
        '#667e6d',
      );
      ellipse(c, 0, -32, 49, 24, '#79694a');
      ellipse(c, 0, -38, 45, 19, '#c0a06b');
      ellipse(c, 0, -40, 31, 13, '#796748');
      for (let i = 0; i < 9; i++) {
        const a = i * 0.8;
        line(
          c,
          [
            [Math.cos(a) * 45, -38 + Math.sin(a) * 17],
            [Math.cos(a + 0.7) * 38, -38 + Math.sin(a + 0.7) * 17],
          ],
          '#d2b680',
          4,
        );
      }
      ellipse(c, 8, -41, 8, 11, '#e4d9ac');
      line(
        c,
        [
          [-29, -39],
          [-29, -83],
        ],
        '#736446',
        3,
      );
      poly(
        c,
        [
          [-28, -83],
          [-4, -78],
          [-28, -64],
        ],
        co.flag,
      );
    } else if (b.type === 'watchtower') {
      poly(
        c,
        [
          [-29, 19],
          [-23, -48],
          [23, -48],
          [29, 19],
          [0, 34],
        ],
        '#768271',
      );
      poly(
        c,
        [
          [0, 34],
          [0, -43],
          [23, -48],
          [29, 19],
        ],
        '#596b60',
      );
      c.fillStyle = '#a7af92';
      c.fillRect(-33, -65, 66, 22);
      for (let x = -33; x < 33; x += 21) c.fillRect(x, -77, 12, 17);
      c.fillStyle = co.dark;
      c.fillRect(-7, -21, 14, 23);
      c.fillStyle = co.cloth;
      c.fillRect(-16, -44, 32, 8);
      line(
        c,
        [
          [-20, 0],
          [-6, 0],
        ],
        '#a0a68b',
        2,
      );
      line(
        c,
        [
          [10, 13],
          [25, 13],
        ],
        '#81927b',
        2,
      );
      line(
        c,
        [
          [0, -66],
          [0, -103],
        ],
        '#655940',
        3,
      );
      poly(
        c,
        [
          [1, -103],
          [31, -98],
          [1, -86],
        ],
        co.flag,
      );
    } else if (b.type === 'mint') {
      poly(
        c,
        [
          [-46, 23],
          [-39, -18],
          [-12, -42],
          [23, -36],
          [46, -6],
          [42, 25],
        ],
        '#839078',
      );
      poly(
        c,
        [
          [-12, -42],
          [23, -36],
          [46, -6],
          [10, -9],
        ],
        '#a2aa8d',
      );
      c.fillStyle = '#334535';
      c.beginPath();
      c.arc(0, 9, 24, Math.PI, 0);
      c.lineTo(24, 30);
      c.lineTo(-24, 30);
      c.fill();
      c.strokeStyle = '#b49563';
      c.lineWidth = 8;
      c.strokeRect(-27, -13, 54, 43);
      poly(
        c,
        [
          [-14, 25],
          [-9, 14],
          [3, 12],
          [12, 21],
          [21, 18],
          [24, 29],
          [-17, 29],
        ],
        '#d8b45e',
      );
      ellipse(c, 5, 16, 4, 3, '#f1d289');
      line(
        c,
        [
          [-5, 30],
          [-18, 45],
        ],
        '#667565',
        3,
      );
      line(
        c,
        [
          [12, 30],
          [24, 45],
        ],
        '#667565',
        3,
      );
    } else {
      poly(
        c,
        [
          [-40, -9],
          [0, -27],
          [40, -9],
          [40, 25],
          [0, 40],
          [-40, 25],
        ],
        '#b3aa82',
      );
      poly(
        c,
        [
          [0, -27],
          [40, -9],
          [40, 25],
          [0, 40],
        ],
        '#8f9473',
      );
      c.fillStyle = co.dark;
      c.fillRect(-22, 0, 17, 28);
      poly(
        c,
        [
          [-49, -14],
          [0, -48],
          [49, -14],
          [3, 9],
        ],
        roof,
      );
      poly(
        c,
        [
          [0, -48],
          [49, -14],
          [3, 9],
          [0, -19],
        ],
        roofLight,
      );
      line(
        c,
        [
          [-49, -14],
          [0, -48],
          [49, -14],
        ],
        '#c1ba8b',
        3,
      );
      for (let i = 0; i < 4; i++)
        line(
          c,
          [
            [-36 + i * 10, -18 - i * 7],
            [-4 + i * 10, 0 - i * 7],
          ],
          roofLight,
          1,
        );
      if (b.type === 'barracks') {
        line(
          c,
          [
            [-40, -30],
            [-40, -67],
          ],
          '#6d6146',
          3,
        );
        poly(
          c,
          [
            [-39, -67],
            [-12, -61],
            [-39, -48],
          ],
          co.flag,
        );
        ellipse(c, 23, 20, 9, 12, co.cloth);
        line(
          c,
          [
            [23, 10],
            [23, 29],
          ],
          '#d3d2ad',
          2,
        );
        line(
          c,
          [
            [17, 19],
            [29, 19],
          ],
          '#d3d2ad',
          2,
        );
      }
      if (b.type === 'archery') {
        c.save();
        c.translate(25, 20);
        ellipse(c, 0, 0, 12, 14, '#d6bd82');
        ellipse(c, 0, 0, 8, 10, '#a76d50');
        ellipse(c, 0, 0, 4, 5, '#e6cf92');
        c.restore();
        line(
          c,
          [
            [32, 15],
            [52, -4],
          ],
          '#ded0a4',
          2,
        );
      }
      if (b.type === 'foundry') {
        c.fillStyle = '#667765';
        c.fillRect(20, -62, 18, 48);
        c.fillStyle = '#a0a78a';
        c.fillRect(17, -67, 24, 8);
        c.fillStyle = '#342f25';
        c.fillRect(-25, 4, 23, 24);
        poly(
          c,
          [
            [-21, 25],
            [-17, 10],
            [-13, 19],
            [-7, 7],
            [-6, 25],
          ],
          '#d88f46',
        );
        ellipse(c, 30, -82 + Math.sin(this.time) * 4, 10, 7, '#d5d3ae40');
        ellipse(c, 36, -98 + Math.sin(this.time + 1) * 5, 13, 8, '#c7c6a52b');
      }
    }
    if (b.level > 1) {
      for (let i = 0; i < b.level; i++)
        poly(
          c,
          [
            [-13 + i * 12, 45],
            [-9 + i * 12, 40],
            [-5 + i * 12, 45],
            [-9 + i * 12, 50],
          ],
          '#eed18d',
        );
    }
    if (!b.ghost) {
      this.health(
        -31,
        b.type === 'wardenLodge' ? -88 : b.type === 'watchtower' ? -91 : -63,
        62,
        b.hp / b.maxHp,
        co.bright,
      );
      if (d.unit) {
        c.fillStyle = '#293d2acc';
        c.fillRect(-25, 43, 50, 3);
        c.fillStyle = '#cfbb7e';
        c.fillRect(-25, 43, 50 * b.progress, 3);
      }
    }
    c.restore();
  }
  drawBase(b) {
    const c = this.c,
      co = COLORS[b.side];
    c.save();
    c.translate(b.x, b.y);
    ellipse(c, 9, 29, 85, 45, '#1e382b50');
    c.fillStyle = '#8d9981';
    c.fillRect(-62, -35, 124, 78);
    poly(
      c,
      [
        [-62, 43],
        [0, 65],
        [62, 43],
        [0, 23],
      ],
      '#677b66',
    );
    c.fillStyle = '#b1b99a';
    c.fillRect(-52, -65, 104, 77);
    c.fillStyle = '#7c9078';
    c.fillRect(4, -65, 48, 77);
    for (const x of [-57, 27]) {
      c.fillStyle = '#a7b298';
      c.fillRect(x, -100, 30, 109);
      c.fillStyle = '#bdc4a3';
      c.fillRect(x - 5, -109, 40, 16);
      for (let a = x - 5; a < x + 35; a += 14) c.fillRect(a, -119, 8, 15);
      c.fillStyle = co.dark;
      c.fillRect(x + 9, -77, 10, 17);
    }
    poly(
      c,
      [
        [-29, -55],
        [0, -84],
        [30, -55],
      ],
      co.cloth,
    );
    c.fillStyle = co.dark;
    c.beginPath();
    c.arc(0, 4, 20, Math.PI, 0);
    c.lineTo(20, 45);
    c.lineTo(-20, 45);
    c.fill();
    line(
      c,
      [
        [0, -78],
        [0, -143],
      ],
      '#5f6145',
      4,
    );
    poly(
      c,
      [
        [2, -144],
        [46, -134],
        [2, -119],
      ],
      co.flag,
    );
    c.fillStyle = co.bright;
    c.font = `bold ${Math.max(13, 10 / this.scale)}px "DM Sans",sans-serif`;
    c.textAlign = 'center';
    c.fillText(b.side ? 'IRON CITADEL' : 'HOME CITADEL', 0, 87);
    this.health(-54, 65, 108, b.hp / b.maxHp, co.bright);
    c.restore();
  }
  drawUnit(u, time) {
    const c = this.c,
      co = COLORS[u.side],
      direction = u.side ? -1 : 1,
      battlefield = Number.isFinite(this.scale) && this.scale > 0,
      modelScale = battlefield ? battlefieldReadability(this.scale).unitScale : 1,
      effectiveScale = battlefield ? this.scale * modelScale : 1,
      outline = battlefield ? Math.min(2.8, 0.8 / effectiveScale) : 0;
    if (u.type === 'rootwarden') {
      c.save();
      c.translate(u.x, u.y);
      if (battlefield) this.drawTeamMarker(u.side, modelScale);
      drawRootwarden(c, { side: u.side, facing: direction, scale: modelScale,
        compact: battlefield && battlefieldReadability(this.scale).compact > 0,
        reducedMotion: this.reducedMotion, marker: false, outline,
        state: u.hit > 0 ? 'hit' : u.attack > 0 ? 'attack' : this.rootwardenMotion?.get(u.id)?.moving ? 'walk' : 'idle',
        // Native damage is immediate: show contact/settle, never a post-damage windup.
        phase: u.hit > 0 ? 1 - u.hit / 0.16 : u.attack > 0 ? 0.48 + 0.52 * (1 - u.attack / 0.22) : 0.5,
        time, seed: u.id });
      if (u.hp < u.maxHp) {
        const width = battlefield ? Math.max(26 * modelScale, 18 / this.scale) : 26;
        this.health(-width / 2, -49 * modelScale, width, u.hp / u.maxHp, co.bright,
          battlefield ? Math.max(3, 2.5 / this.scale) : 3);
      }
      c.restore();
      return;
    }
    const feedback = battlefield ? sampleCombatFeedback(u, this.reducedMotion) : null,
      contact = feedback?.contact || 0,
      recoil = feedback?.recoil || 0,
      moving = u.cooldown <= 0,
      walk = this.reducedMotion ? 0 : Math.sin(time * 11 + u.id) * 2;
    c.save();
    c.translate(u.x, u.y);
    if (battlefield) {
      // A circle for allied troops, a diamond for enemies, independent of color.
      // The marker stays at the actual ground anchor, including for flyers.
      this.drawTeamMarker(u.side, modelScale);
      c.save();
      c.scale(modelScale, modelScale);
    }
    ellipse(
      c,
      2,
      5,
      u.type === 'siege' ? 21 : 10,
      u.type === 'siege' ? 10 : 5,
      '#243b304d',
    );
    if (u.hit && (!battlefield || (!this.reducedMotion && this.vfx?.quality !== 'low'))) {
      c.shadowColor = '#fff3c9';
      c.shadowBlur = 9;
    }
    if (u.type === 'gryphon') ellipse(c, 2, 5, 18, 7, '#243b302b');
    if (recoil) {
      // Art leans about its ground position. Markers, both shadows and health
      // stay outside this transform; no unit coordinates or hit areas move.
      c.save();
      c.translate(0, 5);
      c.rotate(-direction * (u.type === 'siege' ? 0.025 : 0.05) * recoil);
      c.translate(0, -5);
    }
    if (u.type === 'gryphon') {
      const flap = this.reducedMotion ? 0 : Math.sin(time * 8 + u.id) * 10;
      c.translate(0, -30);
      c.scale(direction, 1);
      poly(
        c,
        [
          [-4, -6],
          [-23, -13 - flap],
          [-35, -5 - flap],
          [-20, 5],
          [-4, 7],
        ],
        '#d6c19a', outline,
      );
      poly(
        c,
        [
          [-4, 0],
          [-19, 19 + flap],
          [-31, 15 + flap],
          [-13, 6],
        ],
        '#a99e80', outline,
      );
      ellipse(c, 0, -3, 14, 8, co.cloth, outline);
      if (contact) { c.save(); c.translate(2.5 * contact, contact); }
      ellipse(c, 12, -8, 8, 8, '#e4d9b5', outline);
      poly(
        c,
        [
          [18, -11],
          [27, -5],
          [18, -3],
        ],
        '#d6ab59', outline,
      );
      c.fillStyle = '#3e4c39';
      c.fillRect(14, -10, 2, 2);
      if (contact) c.restore();
      line(
        c,
        [
          [-10, 0],
          [-24, 7],
        ],
        '#dcc8a0',
        4,
      );
      line(
        c,
        [
          [5, 5],
          [7 + 2 * contact, 10],
        ],
        '#dbb16c',
        2,
      );
      line(
        c,
        [
          [-1, 5],
          [-2 + 2 * contact, 11],
        ],
        '#dbb16c',
        2,
      );
    } else if (u.type === 'wizard') {
      const bob = moving ? walk : 0;
      poly(
        c,
        [
          [-10, 7],
          [10, 7],
          [6, -15],
          [-5, -15],
        ],
        co.cloth, outline,
      );
      line(
        c,
        [
          [0, -11],
          [0, 5],
        ],
        '#d4b5ec',
        2,
      );
      ellipse(c, 0, -18 + bob, 6, 6, '#d8bf96', outline);
      poly(
        c,
        [
          [-11, -21 + bob],
          [9, -21 + bob],
          [2, -39 + bob],
        ],
        '#8c75ad', outline,
      );
      if (contact) {
        c.save(); c.translate(direction * 12, 5);
        c.rotate(direction * 0.16 * contact); c.translate(-direction * 12, -5);
      }
      line(
        c,
        [
          [direction * 12, 5],
          [direction * 12, -28],
        ],
        '#c7a674',
        3,
      );
      ellipse(c, direction * 12, -31, 5, 5, '#d8b8ff', outline);
      ellipse(c, direction * 12, -31, 9, 9, '#caa8fa22');
      if (contact) c.restore();
    } else if (u.type === 'siege') {
      c.scale(direction, 1);
      c.fillStyle = '#5b5b42';
      c.fillRect(-17, -12, 33, 18);
      for (const x of [-12, 12]) {
        ellipse(c, x, 6, 6, 8, '#494e3e', outline);
        ellipse(c, x, 6, 2, 3, '#b3a071');
      }
      poly(
        c,
        [
          [-15, -12],
          [-6, -29],
          [11, -21],
          [18, -9],
        ],
        '#a59160', outline,
      );
      if (contact) {
        c.save(); c.translate(-4, -14); c.rotate(0.32 * contact); c.translate(4, 14);
      }
      line(
        c,
        [
          [-4, -14],
          [15, -35],
        ],
        '#dac18d',
        5,
      );
      ellipse(c, 18, -37, 7, 5, '#8b8360', outline);
      if (contact) c.restore();
      c.fillStyle = co.cloth;
      c.fillRect(-17, -12, 5, 17);
    } else {
      const bob = moving ? walk : 0;
      line(
        c,
        [
          [-4, 0],
          [-5 + (moving ? walk : 0), 7],
        ],
        '#514c36',
        3,
      );
      line(
        c,
        [
          [4, 0],
          [5 - (moving ? walk : 0), 7],
        ],
        '#514c36',
        3,
      );
      if (outline) {
        c.strokeStyle = '#182a26'; c.lineWidth = outline * 2;
        c.strokeRect(-7, -13 + bob, 14, 15);
      }
      c.fillStyle = co.cloth;
      c.fillRect(-7, -13 + bob, 14, 15);
      ellipse(c, 0, -17 + bob, 7, 7, '#d7bf8e', outline);
      if (u.type === 'warrior') {
        poly(
          c,
          [
            [-8, -19 + bob],
            [-5, -27 + bob],
            [4, -27 + bob],
            [8, -20 + bob],
          ],
          '#adb8a5', outline,
        );
        c.fillStyle = '#55695c';
        c.fillRect(-7, -20 + bob, 14, 3);
        c.save();
        c.translate(direction * (8 + 1.5 * contact), -5 + bob);
        c.rotate((battlefield ? 0.32 * contact - 0.12 * recoil : u.attack ? 0.5 : 0) * direction);
        poly(
          c,
          [
            [-6, -10],
            [6, -10],
            [7, 2],
            [0, 9],
            [-7, 2],
          ],
          co.dark, outline,
        );
        line(
          c,
          [
            [0, -7],
            [0, 4],
          ],
          '#d3d4ac',
          2,
        );
        line(
          c,
          [
            [-4, -2],
            [4, -2],
          ],
          '#d3d4ac',
          2,
        );
        c.restore();
        line(
          c,
          [
            [direction * -8, -6 + bob],
            [direction * (battlefield ? -16 + 38 * contact : u.attack ? 22 : -16), -24 + bob],
          ],
          '#ddd9b6',
          3,
        );
      } else {
        poly(
          c,
          [
            [-8, -16 + bob],
            [-5, -25 + bob],
            [3, -27 + bob],
            [8, -19 + bob],
          ],
          co.dark, outline,
        );
        if (contact) {
          c.save(); c.translate(direction * 2 * contact, 0);
          c.translate(direction * 9, -9 + bob);
          c.rotate(direction * 0.09 * contact);
          c.translate(-direction * 9, 9 - bob);
        }
        c.strokeStyle = '#d6b77c';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(
          direction * 9,
          -9 + bob,
          11,
          direction > 0 ? -1.2 : 1.95,
          direction > 0 ? 1.2 : 4.35,
        );
        c.stroke();
        line(
          c,
          [
            [direction * 13, -19 + bob],
            [direction * 13, 1 + bob],
          ],
          '#d8dab7',
          1,
        );
        if (contact) c.restore();
      }
    }
    if (recoil) c.restore();
    if (battlefield) c.restore();
    if (u.hp < u.maxHp) {
      const width = battlefield ? Math.max(26 * modelScale, 18 / this.scale) : 26;
      const y = u.type === 'siege' ? -46 : u.type === 'wizard' ? -47 : u.type === 'gryphon' ? -54 : -34;
      this.health(-width / 2, y * modelScale, width, u.hp / u.maxHp, co.bright,
        battlefield ? Math.max(3, 2.5 / this.scale) : 3);
    }
    c.restore();
  }
  drawTeamMarker(side, modelScale) {
    const c = this.c,
      rx = Math.max(10 * modelScale, 6 / this.scale),
      ry = Math.max(3.5 * modelScale, 2.5 / this.scale),
      y = 9 * modelScale;
    c.beginPath();
    if (side) {
      c.moveTo(-rx, y); c.lineTo(0, y - ry);
      c.lineTo(rx, y); c.lineTo(0, y + ry); c.closePath();
    } else c.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2);
    c.strokeStyle = '#182a26';
    c.lineWidth = 3 / this.scale;
    c.stroke();
    c.strokeStyle = side ? '#ffd091' : '#a5efdc';
    c.lineWidth = 1.25 / this.scale;
    c.stroke();
  }
  health(x, y, w, p, color, h = 4) {
    const c = this.c, scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1,
      border = Math.max(1, 0.75 / scale);
    h = Math.max(h, 2 / scale);
    c.fillStyle = '#142720ed';
    c.fillRect(x - border, y - border, w + border * 2, h + border * 2);
    c.fillStyle = color;
    c.fillRect(x, y, w * Math.max(0, Math.min(1, p)), h);
  }
  drawEffect(e) {
    const c = this.c,
      age = Math.max(0, Math.min(1, 1 - e.life / e.maxLife)),
      t = this.reducedMotion ? 0.45 : age;
    c.save();
    c.translate(e.x, e.y);
    c.globalAlpha = 1 - age;
    if (e.type === 'volley') {
      c.strokeStyle = '#edd59d';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(0, 0, e.radius * (0.7 + 0.3 * t), 0, Math.PI * 2);
      c.stroke();
      const arrows = this.vfx?.quality === 'low' ? 7 : 18;
      for (let i = 0; i < arrows; i++) {
        const a = i * 2.4,
          r = Math.sqrt(i / arrows) * e.radius,
          x = Math.cos(a) * r,
          y = Math.sin(a) * r;
        c.strokeStyle = '#f8e3aa';
        line(
          c,
          [
            [x - 16 * (1 - t), y - 85 * (1 - t)],
            [x, y],
          ],
          '#f8e3aa',
          2,
        );
      }
    } else if (e.type === 'blast' || e.type === 'magic') {
      c.fillStyle = e.type === 'magic' ? '#c7a0eb77' : '#e5b77a77';
      c.beginPath();
      c.arc(0, 0, e.radius * t, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 7; i++)
        ellipse(
          c,
          Math.cos(i * 2.4) * 35 * t,
          Math.sin(i * 2.4) * 35 * t,
          5 * (1 - t) + 2,
          5 * (1 - t) + 2,
          '#f3cf88',
        );
    } else if (e.type === 'build' || e.type === 'upgrade') {
      c.strokeStyle = '#e6d49a';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(0, 20, 55 + t * 20, 25 + t * 13, 0, 0, Math.PI * 2);
      c.stroke();
      if (e.type === 'upgrade') {
        c.fillStyle = '#e8d7a0';
        c.font = '600 18px sans-serif';
        c.textAlign = 'center';
        c.fillText('↑', 0, -65 - t * 40);
      }
    } else if (e.type === 'death') {
      for (let i = 0; i < 5; i++)
        ellipse(
          c,
          Math.cos(i * 2.5) * e.radius * t,
          Math.sin(i * 2.5) * e.radius * t,
          4 * (1 - t),
          4 * (1 - t),
          '#d0b17b',
        );
    } else if (e.type === 'hit') {
      line(
        c,
        [
          [-9, -9],
          [9, 9],
        ],
        '#f5d99b',
        2,
      );
      line(
        c,
        [
          [-9, 9],
          [9, -9],
        ],
        '#f5d99b',
        2,
      );
    }
    c.restore();
  }
  drawMinimap(s, game = null, ui = {}) {
    const c = this.m,
      w = this.mw,
      h = this.mh;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#56704e';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#628476';
    c.fillRect(
      ((this.map.width / 2 - 64) / this.map.width) * w,
      0,
      (128 / this.map.width) * w,
      h,
    );
    c.strokeStyle = '#b4b58c88';
    c.lineWidth = 1;
    for (const y of this.map.lanes) {
      c.beginPath();
      c.moveTo(0, (y / this.map.height) * h);
      c.lineTo(w, (y / this.map.height) * h);
      c.stroke();
    }
    for (const b of s.buildings) {
      c.fillStyle = b.side ? '#e9a080' : '#bbdfaf';
      c.fillRect(
        (b.x / this.map.width) * w - 1,
        (b.y / this.map.height) * h - 1,
        3,
        3,
      );
    }
    for (const u of s.units) {
      c.fillStyle = u.side ? '#df9b77' : '#c7dfaf';
      c.fillRect(
        (u.x / this.map.width) * w,
        (u.y / this.map.height) * h,
        1.5,
        1.5,
      );
    }
    if (this.map.id === 'classic') {
      // Preserve the shipped Classic citadel symbols exactly.
      c.fillStyle = '#f0d28c';
      c.fillRect(4, h / 2 - 3, 4, 6);
      c.fillStyle = '#e5a281';
      c.fillRect(w - 8, h / 2 - 3, 4, 6);
    } else {
      for (const base of s.bases) {
        c.fillStyle = base.side ? '#e5a281' : '#f0d28c';
        c.fillRect(
          (base.x / this.map.width) * w - 2,
          (base.y / this.map.height) * h - 3,
          4,
          6,
        );
      }
    }
    drawFlightMinimap(c, game, { width: w, height: h, selected: ui.selected });
    const vw = Math.min(w, (this.width / this.scale / this.map.width) * w),
      vx = (this.camera / this.map.width) * w - vw / 2;
    c.fillStyle = '#f0ecd415';
    c.fillRect(vx, 0, vw, h);
    c.strokeStyle = '#ece3b9';
    c.lineWidth = 1.5;
    c.strokeRect(vx + 0.75, 0.75, vw - 1.5, h - 1.5);
  }
}

/** Enlarged, static portraits reuse the actual original battlefield models. */
export function drawUnitPortrait(canvas, type, side = 0, context = null) {
  const units = context?.units || context?.ruleset?.units || UNITS;
  if (typeof type !== 'string' || !Object.hasOwn(units, type) || typeof canvas?.getContext !== 'function')
    return false;
  const c = canvas.getContext('2d');
  if (!c) return false;
  canvas.width = 224;
  canvas.height = 200;
  c.setTransform(2, 0, 0, 2, 0, 0);
  c.clearRect(0, 0, 112, 100);
  c.save();
  c.translate(56, 74);
  c.scale(1.6, 1.6);
  const data = units[type];
  Renderer.prototype.drawUnit.call(
    { c, reducedMotion: true },
    {
      type,
      side: side === 1 ? 1 : 0,
      id: 1,
      x: 0,
      y: 0,
      hp: data.hp,
      maxHp: data.hp,
      level: 1,
      cooldown: 1,
      attack: 0,
    },
    0,
  );
  c.restore();
  return true;
}
