import { useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import KeybindingDisplay from "@/ui/keybinding";
import { cn } from "@/utils/cn";
import { useKeybindingConflicts } from "../hooks/use-keybinding-conflicts";
import { useKeymapStore } from "../stores/store";
import type { Command, Keybinding } from "../types";
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

  const source = keybinding?.source || "default";
  const isUserOverride = source === "user";

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,2.2fr)_minmax(180px,1.1fr)_minmax(0,1.6fr)_88px_108px] gap-4 border-b border-border px-2 py-2 transition-colors hover:bg-hover",
        hasConflict && "bg-error/5 hover:bg-error/10",
      )}
    >
      <div className="min-w-0">
        <div className="ui-font ui-text-sm truncate text-text">{command.title}</div>
        <div className="ui-font mt-0.5 truncate text-[11px] text-text-lighter">
          {command.category} • {command.id}
        </div>
      </div>

      <div className="flex items-center">
        {isEditing ? (
          <KeybindingInput
            commandId={command.id}
            value={keybinding?.key}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <Button
            type="button"
            onClick={() => setIsEditing(true)}
            variant="outline"
            size="xs"
            className="flex w-full items-center justify-start px-2 text-xs hover:border-accent"
            aria-label={`Edit keybinding for ${command.title}`}
          >
            {keybinding?.key ? (
              <KeybindingDisplay binding={keybinding.key} />
            ) : (
              <span className="text-text-lighter">Not assigned</span>
            )}
          </Button>
        )}
      </div>

      <div className="ui-font flex items-center truncate text-[11px] text-text-lighter">
        {keybinding?.when || command.keybinding ? keybinding?.when || "-" : "-"}
      </div>

      <div className="flex items-center">
        <Badge variant={isUserOverride ? "accent" : "default"} shape="pill" size="compact">
          {source}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        {isUserOverride && (
          <Button
            type="button"
            onClick={handleReset}
            variant="ghost"
            size="xs"
            className="text-[11px] text-text-lighter hover:text-text"
            title="Reset to default"
            aria-label="Reset to default keybinding"
          >
            Reset
          </Button>
        )}
        {keybinding && (
          <Button
            type="button"
            onClick={handleRemove}
            variant="ghost"
            size="xs"
            className="text-[11px] text-text-lighter hover:text-error"
            title="Remove keybinding"
            aria-label="Remove keybinding"
          >
            Remove
          </Button>
        )}
      </div>

      {hasConflict && (
        <div className="ui-font col-span-5 rounded-lg border border-error/20 bg-error/5 px-2.5 py-2 text-[11px] text-error">
          ⚠ Conflicts with: {conflictingCommands.map((c) => c.title).join(", ")}
        </div>
      )}
    </div>
  );
}
