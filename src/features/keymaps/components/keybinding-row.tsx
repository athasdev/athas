import { useState } from "react";
import KeybindingBadge from "@/ui/keybinding-badge";
import { cn } from "@/utils/cn";
import { useKeybindingConflicts } from "../hooks/use-keybinding-conflicts";
import { useKeymapStore } from "../stores/store";
import type { Command, Keybinding } from "../types";
import { parseKeybinding } from "../utils/parser";
import { keymapRegistry } from "../utils/registry";
import { KeybindingInput } from "./keybinding-input";

interface KeybindingRowProps {
  command: Command;
  keybinding?: Keybinding;
}

export function KeybindingRow({ command, keybinding }: KeybindingRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { addKeybinding, updateKeybinding, removeKeybinding } = useKeymapStore.use.actions();
  const { hasConflict, conflictingCommands } = useKeybindingConflicts(
    keybinding?.key || "",
    command.id,
    keybinding?.when,
  );

  const handleSave = (newKey: string) => {
    if (keybinding) {
      updateKeybinding(command.id, {
        key: newKey,
      });
    } else {
      addKeybinding({
        key: newKey,
        command: command.id,
        source: "user",
        enabled: true,
      });
    }
    setIsEditing(false);
  };

  const handleRemove = () => {
    removeKeybinding(command.id);
  };

  const handleReset = () => {
    const defaultBinding = keymapRegistry
      .getAllKeybindings()
      .find((kb) => kb.command === command.id && kb.source === "default");

    if (defaultBinding) {
      updateKeybinding(command.id, {
        key: defaultBinding.key,
      });
    } else {
      removeKeybinding(command.id);
    }
  };

  const keys = keybinding?.key
    ? parseKeybinding(keybinding.key).parts.flatMap((p) => [
        ...p.modifiers.map((m) => m.charAt(0).toUpperCase() + m.slice(1)),
        p.key.toUpperCase(),
      ])
    : [];

  const source = keybinding?.source || "default";
  const isUserOverride = source === "user";

  return (
    <div
      className={cn(
        "grid grid-cols-[2fr_200px_2fr_80px_100px] gap-4 border-border border-b p-2 hover:bg-hover",
        hasConflict && "bg-error/5",
      )}
    >
      {/* Command info */}
      <div className="flex flex-col">
        <div className="truncate text-text text-xs">{command.title}</div>
        <div className="truncate text-[10px] text-text-lighter">
          {command.category} • {command.id}
        </div>
      </div>

      {/* Keybinding */}
      <div className="flex items-center">
        {isEditing ? (
          <KeybindingInput
            commandId={command.id}
            value={keybinding?.key}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="flex h-7 w-full items-center justify-start rounded border border-border bg-secondary-bg px-2 text-xs hover:border-accent"
            aria-label={`Edit keybinding for ${command.title}`}
          >
            {keys.length > 0 ? (
              <KeybindingBadge keys={keys} />
            ) : (
              <span className="text-text-lighter">Not assigned</span>
            )}
          </button>
        )}
      </div>

      {/* When clause */}
      <div className="flex items-center truncate text-[10px] text-text-lighter">
        {keybinding?.when || command.keybinding ? keybinding?.when || "-" : "-"}
      </div>

      {/* Source */}
      <div className="flex items-center">
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px]",
            isUserOverride ? "bg-accent/10 text-accent" : "text-text-lighter",
          )}
        >
          {source}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isUserOverride && (
          <button
            type="button"
            onClick={handleReset}
            className="text-[10px] text-text-lighter hover:text-text"
            title="Reset to default"
            aria-label="Reset to default keybinding"
          >
            Reset
          </button>
        )}
        {keybinding && (
          <button
            type="button"
            onClick={handleRemove}
            className="text-[10px] text-text-lighter hover:text-error"
            title="Remove keybinding"
            aria-label="Remove keybinding"
          >
            Remove
          </button>
        )}
      </div>

      {/* Conflict indicator */}
      {hasConflict && (
        <div className="col-span-5 px-2 pb-2 text-[10px] text-error">
          ⚠ Conflicts with: {conflictingCommands.map((c) => c.title).join(", ")}
        </div>
      )}
    </div>
  );
}
