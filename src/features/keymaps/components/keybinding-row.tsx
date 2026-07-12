import { useState } from "react";
import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import { cva } from "class-variance-authority";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import KeybindingDisplay from "@/ui/keybinding";
import { cn } from "@/utils/cn";
import { useKeybindingConflicts } from "../hooks/use-keybinding-conflicts";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Command, Keybinding } from "../types/keymaps.types";
import { KeybindingInput } from "./keybinding-input";

export const keybindingTableGridCols = cva(
  "grid-cols-[minmax(220px,2fr)_minmax(156px,1fr)_minmax(128px,1.25fr)_72px_92px]",
);
export const keybindingTableMinWidth = cva("min-w-[700px]");

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
    if (keybinding?.source === "user") {
      // Update existing user keybinding
      updateKeybinding(command.id, { key: newKey });
    } else {
      // Remove any existing user override first, then add new one
      // This handles both "no keybinding" and "default/extension keybinding" cases
      removeKeybinding(command.id);
      addKeybinding({
        key: newKey,
        command: command.id,
        source: "user",
        enabled: true,
        when: keybinding?.when,
      });
    }
    setIsEditing(false);
  };

  const handleRemove = () => {
    removeKeybinding(command.id);
  };

  const handleReset = () => {
    // Remove user override - the default keybinding will be used automatically
    removeKeybinding(command.id);
  };

  const source = keybinding?.source || "default";
  const isUserOverride = source === "user";
  const sourceLabel =
    source === "preset"
      ? "Preset"
      : source === "default"
        ? "Default"
        : source === "extension"
          ? "Extension"
          : "User";

  return (
    <div
      className={cn(
        "grid gap-4 border-b border-border px-2 py-2 transition-colors hover:bg-hover",
        "gap-3 px-1.5 py-1.5",
        keybindingTableGridCols(),
        keybindingTableMinWidth(),
        hasConflict && "bg-error/5 hover:bg-error/10",
      )}
    >
      <div className="min-w-0">
        <div className="font-sans ui-text-sm truncate text-text">{command.title}</div>
        <div className="font-sans ui-text-sm mt-0.5 truncate text-text-lighter">
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
            variant="default"
            size="xs"
            className="ui-text-sm flex h-7 w-full items-center justify-start px-1.5 hover:border-accent"
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

      <div className="font-sans ui-text-sm flex items-center truncate text-text-lighter">
        {keybinding?.when || command.keybinding ? keybinding?.when || "-" : "-"}
      </div>

      <div className="flex items-center">
        <Badge
          variant={isUserOverride ? "accent" : "default"}
          size="compact"
          className="h-6 min-w-[68px] px-2"
        >
          {sourceLabel}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        {isUserOverride && (
          <Button
            type="button"
            onClick={handleReset}
            variant="ghost"
            className="ui-text-sm text-text-lighter hover:text-text"
            tooltip="Reset to default"
            aria-label="Reset to default keybinding"
            size="xs"
          >
            Reset
          </Button>
        )}
        {keybinding && (
          <Button
            type="button"
            onClick={handleRemove}
            variant="ghost"
            className="ui-text-sm text-text-lighter hover:text-error"
            tooltip="Remove keybinding"
            aria-label="Remove keybinding"
            size="xs"
          >
            Remove
          </Button>
        )}
      </div>

      {hasConflict && (
        <div className="font-sans ui-text-sm col-span-5 flex items-start gap-1.5 rounded-lg border border-error/20 bg-error/5 px-2.5 py-2 text-error">
          <WarningCircle className="mt-0.5 shrink-0" size={14} weight="duotone" />
          <span>Conflicts with: {conflictingCommands.map((c) => c.title).join(", ")}</span>
        </div>
      )}
    </div>
  );
}
