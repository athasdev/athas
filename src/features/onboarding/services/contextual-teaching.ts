export type ContextualTipId = "agent-queue-controls" | "global-search-shortcut";

const STORAGE_KEY = "athas-contextual-tips-v1";

export function claimContextualTip(
  tipId: ContextualTipId,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
) {
  if (!storage) return false;

  try {
    const stored = storage.getItem(STORAGE_KEY);
    const seen = new Set<string>(stored ? JSON.parse(stored) : []);
    if (seen.has(tipId)) return false;
    seen.add(tipId);
    storage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
    return true;
  } catch {
    return false;
  }
}
