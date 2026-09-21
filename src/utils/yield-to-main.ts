export function yieldToMain(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;

  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
