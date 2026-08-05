/**
 * Run `task`, then `done()` — whether it settled or threw.
 *
 * This is a one-line `try/finally`, and the reason it lives out here rather
 * than inside the screens that use it is React Compiler. The compiler cannot
 * lower a `finally` statement, and when it meets one it does not skip that
 * function — it gives up on the whole component or hook containing it, which
 * silently costs that entire screen its automatic memoization. A plain
 * module-level function is neither a component nor a hook, so the compiler
 * never looks inside it, and the `finally` is free to do its job.
 *
 * Callers keep the guarantee that matters: a busy flag cleared here clears on
 * the failure path too, so a rejected request cannot leave a spinner turning
 * forever or a button disabled for good.
 *
 * ```ts
 * setSaving(true);
 * await runBusy(() => api.patch('/api/users/zone/', body), () => setSaving(false));
 * ```
 */
export async function runBusy<T>(task: () => Promise<T>, done: () => void): Promise<T> {
  try {
    return await task();
  } finally {
    done();
  }
}
