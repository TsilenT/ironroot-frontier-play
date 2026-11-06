// Pure input state for the standard browser Gamepad API. The app owns polling,
// focus, cursor rendering, and all game actions. Importing this module is inert.
const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
const REPEATING = Object.freeze([...DIRECTIONS, 'previousCard', 'nextCard']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const vector = () => ({ x: 0, y: 0 });
const noop = () => {};

export const DEFAULT_MAPPING = Object.freeze({
  buttons: Object.freeze({
    // Back and pause are processed before confirm, so reset() inside a scope
    // transition callback can discard other actions from the same frame.
    pause: Object.freeze([9]),
    cancel: Object.freeze([1]),
    focus: Object.freeze([2]),
    confirm: Object.freeze([0]),
    rally: Object.freeze([3]),
    previousCard: Object.freeze([4]),
    nextCard: Object.freeze([5]),
    home: Object.freeze([8]),
    frontline: Object.freeze([10]),
    up: Object.freeze([12]),
    down: Object.freeze([13]),
    left: Object.freeze([14]),
    right: Object.freeze([15]),
    precision: Object.freeze([6]),
  }),
  sticks: Object.freeze({
    cursor: Object.freeze([0, 1]),
    camera: Object.freeze([2, 3]),
  }),
});

/** A radial deadzone with full-range rescaling and no diagonal speed bonus. */
export function radialDeadzone(x, y, deadzone = 0.2) {
  x = clamp(finite(x), -1, 1);
  y = clamp(finite(y), -1, 1);
  deadzone = clamp(finite(deadzone, 0.2), 0, 0.95);
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone || magnitude === 0) return vector();
  const length = (Math.min(1, magnitude) - deadzone) / (1 - deadzone);
  return { x: x / magnitude * length, y: y / magnitude * length };
}

/** Move a canvas-local CSS-pixel cursor; dt is in seconds, not milliseconds. */
export function moveCursor(point, axis, dt, bounds, options = {}) {
  const width = Math.max(0, finite(bounds?.width));
  const height = Math.max(0, finite(bounds?.height));
  const padding = Math.max(0, finite(options.padding));
  const xPad = Math.min(width / 2, padding);
  const yPad = Math.min(height / 2, padding);
  const direction = radialDeadzone(axis?.x, axis?.y, 0);
  const seconds = clamp(finite(dt), 0, clamp(finite(options.maxDelta, 0.05), 0, 0.1));
  const speed = Math.max(0, finite(options.speed, 640));
  const precision = options.precision ? clamp(finite(options.precisionScale, 0.3), 0, 1) : 1;
  return {
    x: clamp(finite(point?.x, width / 2) + direction.x * speed * precision * seconds, xPad, width - xPad),
    y: clamp(finite(point?.y, height / 2) + direction.y * speed * precision * seconds, yPad, height - yPad),
  };
}

const available = (item) => item != null && item.disabled !== true && item.hidden !== true && item.focusable !== false;

/** Return an index, not a DOM element. Disabled/hidden entries are skipped. */
export function nextFocusIndex(items, currentIndex, delta = 1, { wrap = true } = {}) {
  if (!Array.isArray(items)) return -1;
  const indices = items.map((item, index) => available(item) ? index : -1).filter((index) => index !== -1);
  if (!indices.length) return -1;
  const step = Math.trunc(finite(delta, 1));
  const current = indices.indexOf(currentIndex);
  if (current < 0) {
    // If a focused control just became disabled, continue from its position.
    if (Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < items.length) {
      const next = step < 0 ? indices.findLast((index) => index < currentIndex) : indices.find((index) => index > currentIndex);
      if (next !== undefined) return next;
      return wrap ? indices[step < 0 ? indices.length - 1 : 0] : indices[step < 0 ? 0 : indices.length - 1];
    }
    return indices[step < 0 ? indices.length - 1 : 0];
  }
  const next = current + step;
  return indices[wrap ? ((next % indices.length) + indices.length) % indices.length : clamp(next, 0, indices.length - 1)];
}

/** Find a different affordable card in at most one pass, or leave it unchanged (-1). */
export function nextAffordableIndex(cards, currentIndex, direction, gold) {
  if (!Array.isArray(cards) || !cards.length || !Number.isFinite(gold) || gold < 0) return -1;
  const count = cards.length;
  const step = finite(direction, 1) < 0 ? -1 : 1;
  const validCurrent = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count;
  const start = validCurrent ? currentIndex : step > 0 ? -1 : count;
  for (let offset = 1; offset <= count; offset++) {
    const index = ((start + step * offset) % count + count) % count;
    if (validCurrent && index === currentIndex) continue;
    const cost = cards[index]?.cost;
    if (Number.isFinite(cost) && cost >= 0 && cost <= gold) return index;
  }
  return -1;
}

function rectOf(item) {
  const rect = item?.rect || item;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) return null;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Directional focus from caller-supplied CSS-pixel rectangles, without wrapping. */
export function spatialFocusIndex(items, currentIndex, direction) {
  if (!Array.isArray(items)) return -1;
  const candidates = items.map((item, index) => available(item) ? { index, rect: rectOf(item) } : null).filter((item) => item?.rect);
  if (!candidates.length) return -1;
  const origin = candidates.find((item) => item.index === currentIndex);
  if (!origin) return candidates[0].index;
  if (!DIRECTIONS.includes(direction)) return currentIndex;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let best = currentIndex, score = Infinity;
  for (const candidate of candidates) {
    if (candidate.index === currentIndex) continue;
    const dx = candidate.rect.x - origin.rect.x, dy = candidate.rect.y - origin.rect.y;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 0) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    // Favor same-row/column neighbors without forbidding diagonal layouts.
    const nextScore = Math.hypot(forward, cross) + cross * 3 + cross * cross / forward;
    if (nextScore < score) { score = nextScore; best = candidate.index; }
  }
  return best;
}

function bindings(value, name) {
  if (value == null) return [];
  const indices = Array.isArray(value) ? value : [value];
  if (!indices.every((index) => Number.isInteger(index) && index >= 0 && index <= 255))
    throw new TypeError(`Invalid controller binding: ${name}`);
  return [...new Set(indices)];
}

function makeMapping(mapping = {}) {
  const buttons = {};
  for (const [name, value] of Object.entries({ ...DEFAULT_MAPPING.buttons, ...mapping.buttons }))
    buttons[name] = bindings(value, name);
  const sticks = {};
  for (const [name, value] of Object.entries({ ...DEFAULT_MAPPING.sticks, ...mapping.sticks })) {
    if (value == null) { sticks[name] = []; continue; }
    if (!Array.isArray(value) || value.length !== 2)
      throw new TypeError(`Controller stick ${name} requires two axis indices`);
    sticks[name] = bindings(value, name);
    if (sticks[name].length !== 2) throw new TypeError(`Controller stick ${name} requires distinct axes`);
  }
  return { buttons, sticks };
}

function browserGamepads() {
  // Navigator is intentionally resolved at poll time, not import/construction.
  const navigator = globalThis.navigator;
  return typeof navigator?.getGamepads === 'function' ? navigator.getGamepads() : [];
}

function readPads(provider) {
  try {
    const result = provider();
    const length = clamp(Math.trunc(finite(result?.length)), 0, 64);
    const pads = [];
    for (let slot = 0; slot < length; slot++) {
      const pad = result[slot];
      if (pad && typeof pad === 'object' && pad.connected !== false && Number.isInteger(pad.index) && pad.index >= 0) pads.push(pad);
    }
    return pads;
  } catch {
    // Access can throw SecurityError in sandboxed or policy-blocked browsers.
    return [];
  }
}

function identity(pad) {
  return pad ? `${pad.index}:${String(pad.id || '')}:${String(pad.mapping || '')}` : null;
}
function description(pad) {
  return pad ? { index: pad.index, id: String(pad.id || ''), mapping: String(pad.mapping || '') } : null;
}
function readButton(sample, wasDown, press, release) {
  if (sample === true) return true;
  if (sample?.pressed === true) return true;
  const value = typeof sample === 'number' ? sample : sample?.value;
  return finite(value) >= (wasDown ? release : press);
}
function normalizeContext(context) {
  const mode = typeof context === 'string' ? context : context?.mode;
  const safeMode = ['menu', 'gameplay'].includes(mode) ? mode : 'disabled';
  const key = typeof context === 'object' && context !== null ? String(context.key ?? '') : '';
  return { mode: safeMode, key: `${safeMode}:${key}` };
}

export class GamepadInput {
  constructor({
    getGamepads = browserGamepads,
    onAction = noop,
    onMove = noop,
    onConnection = noop,
    mapping = {},
    allowUnmapped = false,
    deadzone = 0.2,
    repeatDelay = 350,
    repeatInterval = 110,
    repeatActions = REPEATING,
    buttonPress = 0.55,
    buttonRelease = 0.4,
    navigationPress = 0.55,
    navigationRelease = 0.35,
    maxDelta = 0.05,
  } = {}) {
    this.getGamepads = typeof getGamepads === 'function' ? getGamepads : () => [];
    this.onAction = typeof onAction === 'function' ? onAction : noop;
    this.onMove = typeof onMove === 'function' ? onMove : noop;
    this.onConnection = typeof onConnection === 'function' ? onConnection : noop;
    this.mapping = makeMapping(mapping);
    this.allowUnmapped = allowUnmapped === true;
    this.deadzone = clamp(finite(deadzone, 0.2), 0, 0.95);
    this.repeatDelay = Math.max(0, finite(repeatDelay, 350));
    this.repeatInterval = Math.max(16, finite(repeatInterval, 110));
    this.repeatActions = new Set(Array.isArray(repeatActions) ? repeatActions : REPEATING);
    this.buttonPress = clamp(finite(buttonPress, 0.55), 0.01, 1);
    this.buttonRelease = clamp(finite(buttonRelease, 0.4), 0.001, this.buttonPress);
    this.navigationPress = clamp(finite(navigationPress, 0.55), 0.01, 1);
    this.navigationRelease = clamp(finite(navigationRelease, 0.35), 0.001, this.navigationPress);
    this.maxDelta = clamp(finite(maxDelta, 0.05), 0, 0.1);
    this._active = null;
    this._identity = null;
    this._generation = 0;
    this.reset();
  }

  /** Clear input intent without changing ownership of the connected gamepad. */
  reset() {
    this._generation++;
    this._states = new Map();
    this._buttons = new Map();
    this._lastTime = null;
    this._context = null;
    this._needsBaseline = true;
    this._stickDirection = null;
    this._dpadDirection = null;
    this._cursorArmed = false;
    this._cameraArmed = false;
  }

  _stick(pad, name) {
    const indices = this.mapping.sticks[name] || [];
    return radialDeadzone(pad?.axes?.[indices[0]], pad?.axes?.[indices[1]], this.deadzone);
  }

  _navigation(axis) {
    const horizontal = Math.abs(axis.x) >= Math.abs(axis.y);
    const value = horizontal ? axis.x : axis.y;
    const direction = horizontal ? value < 0 ? 'left' : 'right' : value < 0 ? 'up' : 'down';
    const threshold = direction === this._stickDirection ? this.navigationRelease : this.navigationPress;
    this._stickDirection = Math.abs(value) >= threshold ? direction : null;
    return this._stickDirection;
  }

  /** Poll once per frame. nowMs is monotonic milliseconds (e.g. rAF time). */
  update(nowMs, context = 'gameplay') {
    const scope = normalizeContext(context);
    const invalidClock = !Number.isFinite(nowMs) || (this._lastTime !== null && nowMs < this._lastTime);
    const now = finite(nowMs, this._lastTime ?? 0);
    const elapsed = this._lastTime === null ? 0 : (now - this._lastTime) / 1000;
    const pads = readPads(this.getGamepads);
    const supported = pads.filter((pad) => pad.mapping === 'standard' || this.allowUnmapped);
    const pad = supported.find((candidate) => identity(candidate) === this._identity) || supported[0] || null;
    const id = identity(pad);
    const changed = id !== this._identity;
    if (changed) {
      const old = this._active;
      this._identity = id;
      this._active = description(pad);
      this.reset();
      if (old) this.onConnection({ connected: false, gamepad: old });
      if (pad) this.onConnection({ connected: true, gamepad: { ...this._active } });
    }
    const baseline = this._needsBaseline || this._context !== scope.key || invalidClock;
    if (baseline) {
      this._states.clear();
      this._buttons.clear();
      this._stickDirection = null;
      this._dpadDirection = null;
      this._cursorArmed = false;
      this._cameraArmed = false;
    }
    this._lastTime = now;
    this._context = scope.key;
    this._needsBaseline = false;
    const frame = {
      connected: !!pad,
      gamepad: pad ? { ...this._active } : null,
      unsupported: pads.filter((candidate) => !supported.includes(candidate)).map(description),
      mode: scope.mode,
      time: now,
      dt: baseline || !pad || scope.mode === 'disabled' ? 0 : clamp(elapsed, 0, this.maxDelta),
      cursor: vector(),
      camera: vector(),
      precision: false,
      actions: [],
    };
    if (!pad || scope.mode === 'disabled') {
      // Keep disabled polling cheap, while ensuring no stale hold survives it.
      this._needsBaseline = true;
      this.onMove(frame);
      return frame;
    }

    const raw = {};
    for (const [action, indices] of Object.entries(this.mapping.buttons)) {
      raw[action] = false;
      for (const index of indices) {
        // Evaluate every binding, even after a match, to preserve hysteresis.
        const down = readButton(pad.buttons?.[index], this._buttons.get(index) === true, this.buttonPress, this.buttonRelease);
        this._buttons.set(index, down);
        raw[action] = raw[action] || down;
      }
    }
    const cursor = this._stick(pad, 'cursor');
    const camera = this._stick(pad, 'camera');
    if (cursor.x === 0 && cursor.y === 0) this._cursorArmed = true;
    if (camera.x === 0 && camera.y === 0) this._cameraArmed = true;
    const dpadHeld = DIRECTIONS.some((direction) => raw[direction]);
    const x = Number(!!raw.right) - Number(!!raw.left);
    const y = Number(!!raw.down) - Number(!!raw.up);
    const dpadChoices = [y < 0 ? 'up' : y > 0 ? 'down' : null, x < 0 ? 'left' : x > 0 ? 'right' : null].filter(Boolean);
    this._dpadDirection = dpadChoices.includes(this._dpadDirection) ? this._dpadDirection : dpadChoices[0] || null;
    const stickDirection = scope.mode === 'menu' && this._cursorArmed ? this._navigation(cursor) : null;
    const direction = dpadHeld ? this._dpadDirection : stickDirection;
    for (const name of DIRECTIONS) raw[name] = direction === name;

    const pending = [];
    for (const [action, down] of Object.entries(raw)) {
      let state = this._states.get(action);
      if (!state) {
        state = { down: !!down, armed: !down, nextRepeat: Infinity };
        this._states.set(action, state);
        // Every action is initialized during the baseline frame. Never create
        // an edge from a newly discovered held button.
        if (baseline) continue;
      }
      if (!down) {
        state.down = false;
        state.armed = true;
        state.nextRepeat = Infinity;
      } else {
        if (state.armed && !state.down) {
          if (action !== 'precision') pending.push({ action, phase: 'press', time: now });
          state.nextRepeat = now + this.repeatDelay;
        } else if (state.armed && this.repeatActions.has(action) && action !== 'precision' && now >= state.nextRepeat) {
          pending.push({ action, phase: 'repeat', time: now });
          state.nextRepeat = now + this.repeatInterval;
        }
        state.down = true;
      }
    }
    if (scope.mode === 'gameplay') {
      if (this._cursorArmed) frame.cursor = cursor;
      if (this._cameraArmed) frame.camera = camera;
      const precision = this._states.get('precision');
      frame.precision = !!(precision?.down && precision.armed);
    }
    const generation = this._generation;
    for (const event of pending) {
      frame.actions.push(event);
      this.onAction(event);
      if (generation !== this._generation) {
        frame.cursor = vector();
        frame.camera = vector();
        frame.precision = false;
        break;
      }
    }
    this.onMove(frame);
    return frame;
  }
}
