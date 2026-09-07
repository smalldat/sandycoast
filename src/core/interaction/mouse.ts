/**
 * Cancellable mouse-hook contract shared by every visual.
 *
 * A chart's built-in pointer behavior (select on click, highlight on hover) is
 * handed to the caller as `defaultAction()` so a hook can run it, run it late,
 * or not at all — overriding behavior without forking the chart.
 *
 * Hooks are **not** a replacement for the emitter events: `hover` / `select`
 * still fire even when a hook cancels the default, because an observer is not
 * an override, and a caller who suppresses the built-in selection should still
 * be able to hear about the click.
 */

export interface MouseHookContext<M, E extends Event = PointerEvent> {
  /** The mark under the pointer, or `null` for the chart background. */
  meta: M | null;
  /** The raw DOM event — modifier keys, coordinates, `preventDefault`. */
  native: E;
  /** Pointer position in CSS px, relative to the chart element. */
  px: { x: number; y: number };
  /**
   * Run the chart's built-in behavior for this event. Idempotent: calling it
   * twice runs the behavior once, so a hook can never double-apply it.
   */
  defaultAction(): void;
}

/**
 * What a hook returns: `false` to suppress the built-in behavior, anything
 * else to let it run.
 *
 * `void` is in the union deliberately — it is what lets a hook body simply not
 * return, and `(ctx) => { log(ctx) }` is the common case. Narrowing to
 * `boolean | undefined` would reject exactly that, because a void-returning
 * function is not assignable to an undefined-returning one.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: see above — the union is the contract
export type MouseHookResult = boolean | void;

/**
 * A caller's handler. Return `false` to suppress the built-in behavior;
 * return `true`/`undefined` to let it run after the hook — unless the hook
 * already called {@link MouseHookContext.defaultAction} itself.
 */
export type MouseHook<M, E extends Event = PointerEvent> = (
  ctx: MouseHookContext<M, E>,
) => MouseHookResult;

/**
 * Run `hook` (if any) around `fallback`, honoring the cancellation contract.
 *
 * With no hook installed this is exactly `fallback()`, so a chart wires every
 * pointer path through here without changing its behavior for callers who never
 * supply a hook.
 */
export function runMouseHook<M, E extends Event>(
  hook: MouseHook<M, E> | undefined,
  meta: M | null,
  native: E,
  px: { x: number; y: number },
  fallback: () => void,
): void {
  if (!hook) {
    fallback();
    return;
  }
  let ran = false;
  const defaultAction = () => {
    if (ran) return;
    ran = true;
    fallback();
  };
  const result = hook({ meta, native, px, defaultAction });
  // `false` cancels. Anything else runs the default — but `ran` makes that a
  // no-op when the hook already invoked it, so ordering the call early inside a
  // hook never costs a second application.
  if (result !== false) defaultAction();
}
