import { useMemo } from "react";
import { useKeymapStore } from "../stores/store";
import type { Command } from "../types";
import { keymapRegistry } from "../utils/registry";

interface ConflictInfo {
  hasConflict: boolean;
  conflictingCommands: Command[];
}

export function useKeybindingConflicts(
  keybinding: string,
  currentCommandId: string,
  whenClause?: string,
): ConflictInfo {
  const keybindings = useKeymapStore.use.keybindings();

  const conflictInfo = useMemo(() => {
    if (!keybinding) {
      return { hasConflict: false, conflictingCommands: [] };
    }

    const conflicting = keybindings.filter((kb) => {
      if (kb.command === currentCommandId) return false;
      if (kb.key !== keybinding) return false;
      if (!kb.enabled) return false;

      if (whenClause === kb.when) {
        return true;
      }

      if (!whenClause && !kb.when) {
        return true;
      }

      return false;
    });

    const conflictingCommands = conflicting
      .map((kb) => keymapRegistry.getCommand(kb.command))
      .filter((cmd): cmd is Command => cmd !== undefined);

    return {
      hasConflict: conflictingCommands.length > 0,
      conflictingCommands,
    };
  }, [keybinding, keybindings, currentCommandId, whenClause]);

  return conflictInfo;
}
