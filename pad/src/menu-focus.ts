const returnTargets = new WeakMap<EventTarget, HTMLElement>();

export function hasNewFocus(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    active.isConnected &&
    active !== document.body &&
    active !== document.documentElement &&
    !active.hasAttribute('data-reka-focus-guard') &&
    !active.closest('[role="menu"], [role="listbox"]')
  );
}

export function rememberMenuFocus(event: Event) {
  if (event.target && document.activeElement instanceof HTMLElement)
    returnTargets.set(event.target, document.activeElement);
}

/** Reka schedules default restoration in a timer. Restore now so later typing keeps its focus. */
export function restoreMenuFocus(event: Event) {
  const delegated = event.defaultPrevented;
  const target = event.target ? returnTargets.get(event.target) : undefined;
  if (event.target) returnTargets.delete(event.target);
  event.preventDefault();
  if (!delegated && !hasNewFocus() && target?.isConnected) target.focus({ preventScroll: true });
}
