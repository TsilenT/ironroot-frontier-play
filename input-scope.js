// A physical gesture belongs to the input scope in which it started. Keeping
// its origin through release also covers the browser's later compatibility
// click. No debounce window: a new independent press is immediately usable.
export function createInputScopeGuard(initialScope = null) {
  let scope = initialScope, generation = 0;
  const pointers = new Map(), completed = new Map(), keys = new Map();
  const primary = new Map();
  let latestPrimary = null;
  const stale = (gesture) => !!gesture &&
    (gesture.cancelled || gesture.generation !== generation);
  const activationKey = (code) => code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
  const staleKey = (gesture, event) => stale(gesture) ||
    (!!gesture && activationKey(event.code) && gesture.target !== event.target);
  function retire(pointerId, gesture) {
    pointers.delete(pointerId);
    completed.set(pointerId, gesture);
    // Retain recent pointer IDs for click attribution without an unbounded
    // session history. Legacy MouseEvents use the primary records below.
    if (completed.size > 32) completed.delete(completed.keys().next().value);
  }

  return {
    setScope(next) {
      if (next === scope) return false;
      scope = next;
      generation++;
      return true;
    },
    pointerDown(event) {
      const gesture = {
        generation, pointerType: event.pointerType || 'mouse', cancelled: false,
      };
      pointers.set(event.pointerId, gesture);
      completed.delete(event.pointerId);
      if (event.isPrimary !== false) {
        primary.set(gesture.pointerType, gesture);
        latestPrimary = gesture;
      }
    },
    pointerEnd(event, cancelled = false) {
      const gesture = pointers.get(event.pointerId) || completed.get(event.pointerId);
      if (!gesture) return false;
      gesture.cancelled ||= cancelled;
      retire(event.pointerId, gesture);
      return stale(gesture);
    },
    click(event) {
      // Native keyboard/assistive clicks have detail 0. Controller .click()
      // is untrusted. Their own key/controller guards handle held buttons.
      if (event.isTrusted === false || event.detail === 0) return false;
      let gesture;
      if (Number.isFinite(event.pointerId) && event.pointerId >= 0) {
        gesture = pointers.get(event.pointerId) || completed.get(event.pointerId);
      } else if (event.sourceCapabilities?.firesTouchEvents) {
        gesture = primary.get('touch');
      } else if (event.pointerType) {
        gesture = primary.get(event.pointerType);
      } else {
        gesture = latestPrimary;
      }
      return stale(gesture);
    },
    keyDown(event) {
      if (!event.repeat) keys.set(event.code, {generation, target: event.target});
      // A repeat first observed after a focus/window interruption is not a
      // fresh press. Wait for release, not a wall-clock timeout.
      const gesture = keys.get(event.code);
      return !gesture || staleKey(gesture, event);
    },
    keyUp(event) {
      const gesture = keys.get(event.code);
      keys.delete(event.code);
      return staleKey(gesture, event);
    },
    interruptKeys() {
      // Binding capture retires held keys without swallowing the fresh mouse
      // click that deliberately moves focus to another native Options control.
      for (const gesture of keys.values()) gesture.cancelled = true;
    },
    interrupt() {
      // Blur can lose pointerup/cancel entirely. Retire the same objects, so
      // stale clicks still match their origin and primary fallback, but absent
      // terminal events cannot accumulate abandoned active contacts.
      for (const [pointerId, gesture] of pointers) {
        gesture.cancelled = true;
        retire(pointerId, gesture);
      }
      for (const gesture of completed.values()) gesture.cancelled = true;
      for (const gesture of keys.values()) gesture.cancelled = true;
    },
  };
}
