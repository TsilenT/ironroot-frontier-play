/**
 * Original 2D Canvas art, independent of engine types, timing, damage and health.
 * x/y are the ground anchor; scale is presentation-only. No simulation mutation.
 * Caller owns camera, gameplay bounds, health bars and production progress.
 */
export const ROOTWARDEN_STATES = Object.freeze(['idle', 'walk', 'attack', 'hit']);
export const WARDEN_LODGE_STATES = Object.freeze(['idle', 'working', 'hit']);
export const ROOTWARDEN_BOUNDS = Object.freeze({ left: -25, top: -44, right: 28, bottom: 20 });
export const WARDEN_LODGE_BOUNDS = Object.freeze({ left: -58, top: -76, right: 59, bottom: 44 });
export const ROOTWARDEN_PALETTE = Object.freeze([
  Object.freeze({ cloth: '#539d95', bright: '#b4e3c3', dark: '#214d4a', flag: '#80c5ad', marker: '#a5efdc' }),
  Object.freeze({ cloth: '#ad6554', bright: '#edbb92', dark: '#683e35', flag: '#d59070', marker: '#ffd091' }),
]);
const INK = '#182a26', WOOD = '#8e7954', WOOD_LIGHT = '#c2aa79';
const STONE = '#aab49b', STONE_DARK = '#697e6d', TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
const safe = options => options && typeof options === 'object' ? options : {};
const bounded = (n, fallback, min, max) => clamp(finite(n, fallback), min, max);

function normalize(options) {
  const o = safe(options);
  const side = o.side === 1 ? 1 : 0;
  return {
    x: bounded(o.x, 0, -1e7, 1e7), y: bounded(o.y, 0, -1e7, 1e7), side,
    facing: o.facing === -1 || o.facing === 1 ? o.facing : side ? -1 : 1,
    scale: bounded(o.scale, 1, .01, 64),
    outline: bounded(o.outline, 1.15, 0, 2.8),
    compact: o.compact === true, reducedMotion: o.reducedMotion === true,
    marker: o.marker === true, markerWidth: bounded(o.markerWidth, 1.25, .25, 6),
    time: finite(o.time) % (TAU / 7),
    phase: bounded(o.phase, .5, 0, 1),
    seed: bounded(o.seed, 0, -1000, 1000),
    state: o.state,
  };
}
function polygon(c, points, fill, outline = 0, ink = INK) {
  c.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
  if (outline) { c.strokeStyle = ink; c.lineWidth = outline * 2; c.stroke(); }
  c.fillStyle = fill; c.fill();
}
function oval(c, x, y, rx, ry, fill, outline = 0) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (outline) { c.strokeStyle = INK; c.lineWidth = outline * 2; c.stroke(); }
  c.fillStyle = fill; c.fill();
}
function line(c, points, stroke, width = 1) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = stroke; c.lineWidth = width; c.stroke();
}
// Same circle/diamond vocabulary as the accepted renderer, not a second team code.
function teamMark(c, side, x, y, rx, ry, width, fill = null) {
  c.beginPath();
  if (side) {
    c.moveTo(x - rx, y); c.lineTo(x, y - ry); c.lineTo(x + rx, y); c.lineTo(x, y + ry); c.closePath();
  } else c.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.strokeStyle = INK; c.lineWidth = width + 1.5; c.stroke();
  c.strokeStyle = ROOTWARDEN_PALETTE[side].marker; c.lineWidth = width; c.stroke();
}
function rootCrest(c, x, y, scale, color) {
  c.save();
  try {
    c.translate(x, y); c.scale(scale, scale);
    line(c, [[0, -5], [0, 5]], color, 1.6);
    line(c, [[-4, -4], [0, 0], [4, -4]], color, 1.6);
    line(c, [[-4, 5], [0, 2], [4, 5]], color, 1.6);
  } finally { c.restore(); }
}
function setup(c, o) {
  c.translate(o.x, o.y); c.scale(o.scale, o.scale);
  c.lineJoin = 'round'; c.lineCap = 'round';
}

/** Pure pose sampler. Attack phase: rest → small brace → shield press → settle. */
export function sampleRootwardenPose(options = {}) {
  const o = normalize(options);
  const state = ROOTWARDEN_STATES.includes(o.state) ? o.state : 'idle';
  if (o.reducedMotion) return Object.freeze({
    state, bodyX: 0, bodyY: 0, lean: 0, backFoot: 0, frontFoot: 0,
    shieldX: state === 'attack' ? 1.5 : 0, shieldAngle: 0, hitRim: state === 'hit',
  });
  const step = state === 'walk' ? Math.sin(o.time * 7 + o.seed) : 0;
  let press = 0;
  if (state === 'attack') {
    const p = o.phase;
    press = p < .24 ? -p / .24 : p < .48 ? -1 + (p - .24) / .24 * 3.4 : 2.4 * (1 - (p - .48) / .52);
  }
  press = press || 0; // Avoid negative zero at the resting endpoint.
  const hit = state === 'hit' ? Math.sin(o.phase * Math.PI) : 0;
  return Object.freeze({
    state, bodyX: press * .22 - hit * .8,
    bodyY: state === 'walk' ? -.65 * Math.abs(step) : 0,
    lean: press * .009 - hit * .025,
    backFoot: step * 1.65, frontFoot: -step * 1.65,
    shieldX: press, shieldAngle: -press * .018 + hit * .035,
    hitRim: state === 'hit',
  });
}

/**
 * Draw an original stocky, two-legged guardian. Default model is facing right.
 * size≈38×45 world px, broad shield first; no wheels, ranged weapon or wings.
 * A static team badge remains visible even when external ground markers are off.
 */
export function drawRootwarden(c, options = {}) {
  const o = normalize(options), pose = sampleRootwardenPose(options), co = ROOTWARDEN_PALETTE[o.side];
  c.save();
  try {
    setup(c, o);
    oval(c, 1, 7.5, 17, 5.2, '#243b304d');
    if (o.marker) teamMark(c, o.side, 0, 11, 16, 3.8, o.markerWidth);
    c.scale(o.facing, 1);
    // Separated dark feet keep the broad silhouette visibly alive, not a cart.
    polygon(c, [[-13 + pose.backFoot, -3], [-5 + pose.backFoot, -3], [-4 + pose.backFoot, 7], [-15 + pose.backFoot, 7]], '#565a40', o.outline);
    polygon(c, [[3 + pose.frontFoot, -3], [10 + pose.frontFoot, -3], [13 + pose.frontFoot, 7], [2 + pose.frontFoot, 7]], '#72785b', o.outline);
    line(c, [[-13 + pose.backFoot, 6], [-7 + pose.backFoot, 6]], WOOD_LIGHT, 1.8);
    line(c, [[5 + pose.frontFoot, 6], [11 + pose.frontFoot, 6]], WOOD_LIGHT, 1.8);
    c.translate(pose.bodyX, pose.bodyY); c.rotate(pose.lean);
    // Layered bark back and a bright slab mantle form a compact protective arch.
    polygon(c, [[-16, -26], [-9, -32], [6, -31], [12, -22], [9, 1], [-11, 2], [-16, -9]], WOOD, o.outline);
    polygon(c, [[-16, -25], [-10, -31], [-6, -18], [-8, 0], [-13, 0], [-17, -14]], '#6e684b');
    polygon(c, [[-13, -27], [-7, -32], [8, -31], [13, -24], [7, -19], [-10, -20]], STONE, o.outline);
    polygon(c, [[-13, -27], [-8, -23], [-10, -20], [-16, -22]], STONE_DARK);
    polygon(c, [[-6, -33], [-3, -38], [5, -38], [10, -33], [9, -26], [-4, -26]], '#bbc0a2', o.outline);
    polygon(c, [[4, -37], [10, -33], [9, -26], [4, -26]], '#85947c');
    line(c, [[1, -31], [8, -31]], INK, 2.4);
    // Team cloth visible on the rear shoulder, not hidden entirely by the shield.
    polygon(c, [[-14, -20], [-7, -19], [-7, -3], [-12, 0], [-15, -5]], co.cloth, o.outline * .5);
    if (!o.compact) line(c, [[-11, -18], [-10, -5]], co.bright, 1.2);
    // A hand holding the shield; no oversized offensive weapon.
    oval(c, 5, -14, 4, 4.5, WOOD_LIGHT, o.outline * .7);
    c.save();
    try {
      c.translate(pose.shieldX, 0); c.rotate(pose.shieldAngle);
      const shield = [[-3, -25], [7, -29], [18, -24], [20, -3], [9, 5], [-3, -1], [-5, -13]];
      polygon(c, shield, '#c0b287', o.outline);
      polygon(c, [[0, -22], [7, -25], [15, -21], [17, -5], [9, 1], [0, -3], [-1, -13]], co.dark);
      polygon(c, [[7, -25], [15, -21], [17, -5], [9, 1], [7, -1]], co.cloth);
      // A broad stone spine and small root forks link unit and lodge at every LOD.
      rootCrest(c, 7.5, -12, o.compact ? 1.05 : 1, co.bright);
      if (!o.compact) {
        line(c, [[2, -19], [2, -6]], WOOD_LIGHT, 1.1);
        line(c, [[13, -18], [14, -8]], WOOD_LIGHT, 1.1);
      }
      if (pose.hitRim) line(c, [[-2, -24], [7, -28], [17, -24], [19, -4]], '#f5dfb2', 2.5);
    } finally { c.restore(); }
    // Circle/diamond clasp, plus optional original ground marker. Shape, not color alone.
    teamMark(c, o.side, -10.5, -23.5, 3.4, 3.1, 1, co.dark);
  } finally { c.restore(); }
  return pose;
}

/** Low hall: layered sod roof, root buttresses, broad shield crest and team banner. */
export function drawWardenLodge(c, options = {}) {
  const o = normalize(options), co = ROOTWARDEN_PALETTE[o.side];
  const state = WARDEN_LODGE_STATES.includes(o.state) ? o.state : 'idle';
  // Working is a fixed visible occupied doorway, not a pulse or fake progress bar.
  c.save();
  try {
    setup(c, o);
    oval(c, 4, 25, 51, 17, '#233a3045');
    polygon(c, [[-43, 14], [-36, -20], [3, -33], [41, -14], [43, 25], [2, 39], [-41, 26]], '#8e9a7c', .8);
    polygon(c, [[2, -24], [41, -14], [43, 25], [2, 39]], '#637c69');
    polygon(c, [[-43, 20], [2, 32], [43, 20], [43, 28], [2, 41], [-43, 28]], '#9ba78b');
    // Four root buttresses make a low braced footprint rather than battlements.
    polygon(c, [[-35, -25], [-27, -24], [-29, 18], [-47, 33], [-53, 29], [-39, 11]], '#8f7851', .9);
    polygon(c, [[30, -19], [37, -16], [40, 13], [53, 29], [43, 33], [30, 20]], WOOD, .9);
    polygon(c, [[-29, -23], [-25, -22], [-29, 18], [-43, 30], [-37, 18]], WOOD_LIGHT);
    polygon(c, [[34, -17], [37, -16], [40, 13], [49, 27], [43, 26]], '#c2aa79');
    // Wide recessed door, a single nonanimated lamp while production is active.
    polygon(c, [[-21, 25], [-21, -3], [-15, -10], [-3, -9], [4, -1], [4, 31]], '#233e33', .7);
    polygon(c, [[-19, 24], [-19, -2], [-13, -7], [-4, -5], [1, 1], [1, 28]], state === 'working' ? '#48654d' : '#314a39');
    if (state === 'working') {
      polygon(c, [[-16, 13], [-13, 3], [-7, 3], [-3, 13]], '#abb992');
      c.fillStyle = co.cloth; c.fillRect(-15, 14, 11, 11);
      c.fillStyle = '#e2c58a'; c.fillRect(-17, -2, 3, 4);
    }
    line(c, [[-23, 25], [-23, -3], [-16, -12], [-2, -10], [6, -2], [6, 30]], '#bba577', 3);
    // Broad two-stage roof: muted moss, warm exposed eaves. Never a wizard spire.
    polygon(c, [[-53, -20], [-27, -47], [-3, -57], [26, -46], [52, -20], [4, 0]], '#6c7253', 1);
    polygon(c, [[-52, -23], [-27, -49], [-3, -60], [26, -49], [52, -23], [4, -4]], '#6e8864');
    polygon(c, [[-3, -60], [26, -49], [52, -23], [4, -4], [1, -29]], '#849a70');
    polygon(c, [[-37, -36], [-22, -54], [-4, -64], [16, -55], [36, -37], [1, -22]], '#78916b', .7);
    polygon(c, [[-4, -64], [16, -55], [36, -37], [1, -22]], '#9baa7d');
    line(c, [[-53, -20], [4, 0], [52, -20]], '#c6b184', 2.5);
    line(c, [[-37, -36], [1, -22], [36, -37]], '#bec095', 2);
    if (!o.compact) {
      line(c, [[-31, -34], [-16, -45]], '#9fab7d', 1.2);
      line(c, [[18, -29], [31, -35]], '#b0b58a', 1.2);
      line(c, [[11, 31], [35, 23]], '#9aa78a', 1.5);
    }
    // Broad hexagonal shield lintel mirrors the unit's shield construction.
    polygon(c, [[-13, -35], [0, -41], [14, -35], [14, -18], [1, -10], [-12, -17]], '#c3af80', .9);
    polygon(c, [[-9, -32], [0, -36], [10, -32], [10, -20], [1, -15], [-8, -20]], co.dark);
    rootCrest(c, 1, -25, 1.1, co.bright);
    // Cloth hanging on the front wall reads team without recoloring all the moss.
    polygon(c, [[19, -4], [32, -9], [32, 15], [26, 22], [19, 18]], co.cloth, .6);
    teamMark(c, o.side, 25.5, 7, 3.8, 4.2, 1, co.dark);
    if (state === 'hit') line(c, [[-52, -22], [-27, -48], [-4, -62], [16, -54], [36, -36]], '#f5dfb2', 3);
  } finally { c.restore(); }
  return Object.freeze({ state, working: state === 'working', hitRim: state === 'hit' });
}
