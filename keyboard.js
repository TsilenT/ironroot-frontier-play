// Physical KeyboardEvent.code bindings. Missing entries inherit defaults;
// null explicitly unbinds an action. No storage or game rules live here.
export const DEFAULT_BINDINGS = Object.freeze({
  build1: 'Digit1', build2: 'Digit2', build3: 'Digit3', build4: 'Digit4',
  build5: 'Digit5', build6: 'Digit6', build7: 'Digit7', build8: 'Digit8',
  volley: 'KeyR', pause: 'Space', panLeft: 'ArrowLeft', panRight: 'ArrowRight',
});
export const ACTIONS = Object.freeze(Object.keys(DEFAULT_BINDINGS));
export const bindableCode = code => typeof code === 'string' &&
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Left|Right|Up|Down)|Space)$/.test(code);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function effectiveBindings(map) {
  return { ...DEFAULT_BINDINGS, ...map?.bindings };
}
export function bindingConflict(bindings) {
  const seen = new Map();
  for (const action of ACTIONS) {
    const code = bindings[action];
    if (code === null) continue;
    if (seen.has(code)) return { code, actions: [seen.get(code), action] };
    seen.set(code, action);
  }
  return null;
}
export function normalizeKeyboardMap(value) {
  if (!record(value) || value.version !== 1 || !record(value.bindings) ||
      Object.keys(value).some(key => !['version', 'bindings'].includes(key)))
    throw new TypeError('Keyboard controls need version 1 and a bindings map.');
  const bindings = {};
  for (const [action, code] of Object.entries(value.bindings)) {
    if (!ACTIONS.includes(action) || (code !== null && !bindableCode(code)))
      throw new TypeError('Keyboard controls contain an unknown action or reserved key.');
    bindings[action] = code;
  }
  if (bindingConflict(effectiveBindings({ bindings })))
    throw new TypeError('Keyboard controls contain duplicate keys, including default bindings.');
  return { version: 1, bindings };
}
export function keyLabel(code) {
  if (code == null) return 'Unbound';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Numpad ' + code.slice(6);
  return ({ ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow' })[code] || code;
}
export function actionLabel(action, buildings = {}) {
  if (action.startsWith('build')) {
    const index = Number(action.slice(5)) - 1, building = Object.values(buildings)[index];
    return `Build slot ${index + 1}${building ? ' · ' + building.name : ''}`;
  }
  return ({ volley: 'Arrow volley', pause: 'Pause / resume', panLeft: 'Pan left', panRight: 'Pan right' })[action];
}
export function ignoreKeyboardEvent(event) {
  return !!(event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
    event.ctrlKey || event.altKey || event.metaKey || event.shiftKey);
}
export function nativeKeyboardTarget(target, code, allowButtonShortcuts = false) {
  // isContentEditable includes inherited and plaintext-only editing hosts.
  if (target?.isContentEditable || target?.closest?.('input,textarea,select,a[href],summary,[role="textbox"]')) return true;
  // Only the app can admit a button in the current battle scope. Practice
  // omits this opt-in and retains its existing native-control exclusion.
  return !!(target?.closest?.('button') &&
    (!allowButtonShortcuts || ['Enter', 'NumpadEnter', 'Space'].includes(code)));
}
export function keyboardAction(event, map, { allowButtonShortcuts = false } = {}) {
  if (ignoreKeyboardEvent(event) || nativeKeyboardTarget(event.target, event.code, allowButtonShortcuts)) return null;
  const bindings = effectiveBindings(map);
  const action = ACTIONS.find(action => bindings[action] === event.code);
  return action && (!event.repeat || action === 'panLeft' || action === 'panRight') ? action : null;
}
