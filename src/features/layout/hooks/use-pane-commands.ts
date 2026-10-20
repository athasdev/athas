import { useEffect, useRef } from "react";
import { type PaneCommands, registerPaneCommands } from "../services/pane-commands";

/**
 * Registers the calling view's commands under `key` while it is mounted. The latest handlers are
 * always used, so callers can pass inline functions.
 */
export function usePaneCommands(key: string | null, commands: PaneCommands) {
  const latest = useRef(commands);
  latest.current = commands;
  const names = Object.keys(commands).sort().join("\n");
  useEffect(() => {
    if (!key) return;
    const stable = Object.fromEntries(
      names
        .split("\n")
        .filter(Boolean)
        .map((name) => [name, (argument: never) => latest.current[name]?.(argument)]),
    ) as PaneCommands;
    return registerPaneCommands(key, stable);
  }, [key, names]);
}
