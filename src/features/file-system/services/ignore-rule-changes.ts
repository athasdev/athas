import { getBaseName, getDirName } from "@/utils/path-helpers";

type IgnoreRuleChangeListener = (directoryPath: string) => void;

const IGNORE_RULE_FILE_NAMES = new Set([".gitignore", ".ignore"]);
const listeners = new Set<IgnoreRuleChangeListener>();

/** Reports that which entries under `directoryPath` are ignored may have changed. */
export function notifyIgnoreRulesChanged(directoryPath: string) {
  for (const listener of listeners) listener(directoryPath);
}

/** Reports a write, delete, or external change of `path` when it is an ignore file. */
export function notifyIgnoreRuleFileChanged(path: string) {
  if (IGNORE_RULE_FILE_NAMES.has(getBaseName(path, ""))) {
    notifyIgnoreRulesChanged(getDirName(path));
  }
}

export function subscribeToIgnoreRuleChanges(listener: IgnoreRuleChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
