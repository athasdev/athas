import { useState } from "react";
import { WarningCircleIcon as WarningCircle } from "@/ui/icons";
import { cva } from "class-variance-authority";
import { Alert, AlertDescription } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { TableCell, TableRow } from "@/ui/table";
import KeybindingDisplay from "./keybinding";
import { cn } from "@/utils/cn";
import { useKeybindingConflicts } from "../hooks/use-keybinding-conflicts";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Command, Keybinding } from "../types/keymaps.types";
import { KeybindingInput } from "./keybinding-input";

export const keybindingTableMinWidth = cva("min-w-175");

interface KeybindingRowProps {
  command: Command;
  keybinding?: Keybinding;
}

export function KeybindingRow({ command, keybinding }: KeybindingRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { addKeybinding, removeKeybinding } = useKeymapStore.use.actions();
  const displayedKey = keybinding?.enabled === false ? undefined : keybinding?.key;
  const { hasConflict, conflictingCommands } = useKeybindingConflicts(
    displayedKey || "",
    command.id,
    keybinding?.when,
  );

  const handleSave = (newKey: string) => {
    removeKeybinding(command.id);
    addKeybinding({
      key: newKey,
      command: command.id,
      source: "user",
      enabled: true,
      when: keybinding?.when,
    });
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
    <>
      <TableRow className={cn(hasConflict && "bg-destructive/5 hover:bg-destructive/10")}>
        <TableCell className="min-w-0">
          <div className="font-sans ui-text-sm truncate text-foreground">{command.title}</div>
          <div className="font-sans ui-text-sm mt-0.5 truncate text-subtle-foreground">
            {command.category} • {command.id}
          </div>
        </TableCell>

        <TableCell>
          {isEditing ? (
            <KeybindingInput
              commandId={command.id}
              value={displayedKey}
              onSave={handleSave}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <Button
              type="button"
              onClick={() => setIsEditing(true)}
              variant="default"
              className="ui-text-sm flex h-7 w-full items-center justify-start px-1.5 hover:border hover:border-primary"
              aria-label={`Edit keybinding for ${command.title}`}
            >
              {displayedKey ? (
                <KeybindingDisplay binding={displayedKey} />
              ) : (
                <span className="text-subtle-foreground">Not assigned</span>
              )}
            </Button>
          )}
        </TableCell>

        <TableCell className="truncate text-subtle-foreground">
          {keybinding?.when || command.keybinding ? keybinding?.when || "-" : "-"}
        </TableCell>

        <TableCell>
          <Badge variant={isUserOverride ? "accent" : "default"} className="h-6 min-w-17 px-2">
            {sourceLabel}
          </Badge>
        </TableCell>

        <TableCell>
          <div className="flex items-center gap-1">
            {isUserOverride && (
              <Button
                type="button"
                onClick={handleReset}
                variant="ghost"
                className="ui-text-sm text-subtle-foreground hover:text-foreground"
                tooltip="Reset to default"
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
                className="ui-text-sm text-subtle-foreground hover:text-destructive"
                tooltip="Remove keybinding"
                aria-label="Remove keybinding"
              >
                Remove
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {hasConflict && (
        <TableRow className="bg-destructive/5 hover:bg-destructive/5">
          <TableCell colSpan={5} className="pt-0">
            <Alert tone="error" className="py-1.5">
              <WarningCircle />
              <AlertDescription>
                Conflicts with: {conflictingCommands.map((conflict) => conflict.title).join(", ")}
              </AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
