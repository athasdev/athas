import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { KeybindingRow } from "@/features/keymaps/components/keybinding-row";
import { useKeymapStore } from "@/features/keymaps/stores/store";
import type { Keybinding } from "@/features/keymaps/types";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useToast } from "@/features/layout/contexts/toast-context";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { TableHeadCell, TableHeader } from "@/ui/table";
import { cn } from "@/utils/cn";

type FilterType = "all" | "user" | "default" | "extension";

export const KeyboardSettings = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const { showToast } = useToast();

  const userKeybindings = useKeymapStore.use.keybindings();
  const { resetToDefaults } = useKeymapStore.use.actions();

  const commands = useMemo(() => keymapRegistry.getAllCommands(), []);
  const registryKeybindings = useMemo(() => keymapRegistry.getAllKeybindings(), []);

  const getKeybindingForCommand = (commandId: string): Keybinding | undefined => {
    const userBinding = userKeybindings.find((kb) => kb.command === commandId);
    if (userBinding) return userBinding;
    return registryKeybindings.find((kb) => kb.command === commandId);
  };

  const filteredCommands = useMemo(() => {
    const query = searchQuery.toLowerCase();

    return commands.filter((command) => {
      const matchesSearch =
        !query ||
        command.title.toLowerCase().includes(query) ||
        command.id.toLowerCase().includes(query) ||
        command.category?.toLowerCase().includes(query);

      if (!matchesSearch) return false;

      const binding = getKeybindingForCommand(command.id);

      if (filterType === "all") return true;
      if (filterType === "user") return binding?.source === "user";
      if (filterType === "default") return !binding || binding.source === "default";
      if (filterType === "extension") return binding?.source === "extension";

      return true;
    });
  }, [commands, searchQuery, filterType, userKeybindings, registryKeybindings]);

  const handleResetAll = () => {
    if (confirm("Are you sure you want to reset all keybindings to defaults?")) {
      resetToDefaults();
      showToast({ message: "Keybindings reset to defaults", type: "success" });
    }
  };

  const handleExport = () => {
    const userBindings = userKeybindings.filter((kb) => kb.source === "user");
    const json = JSON.stringify(userBindings, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keybindings.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Keybinding[];

        if (!Array.isArray(imported)) {
          showToast({ message: "Invalid keybindings file format", type: "error" });
          return;
        }

        const { addKeybinding } = useKeymapStore.getState().actions;
        for (const binding of imported) {
          addKeybinding(binding);
        }

        showToast({ message: `Imported ${imported.length} keybindings`, type: "success" });
      } catch (error) {
        showToast({ message: `Failed to import keybindings: ${error}`, type: "error" });
      }
    };
    input.click();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 space-y-3">
        <Input
          placeholder="Search keybindings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          size="sm"
          containerClassName="w-full"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["all", "user", "default", "extension"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setFilterType(filter)}
              className={cn(
                "ui-font ui-text-sm inline-flex h-7 items-center rounded-lg px-2.5 transition-colors",
                filterType === filter
                  ? "bg-primary-bg text-text shadow-sm"
                  : "text-text-lighter hover:bg-hover hover:text-text",
              )}
            >
              {filter === "all"
                ? "All"
                : filter === "user"
                  ? "User"
                  : filter === "default"
                    ? "Default"
                    : "Extension"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TableHeader
          gridCols="minmax(0,2.2fr) minmax(180px,1.1fr) minmax(0,1.6fr) 88px 108px"
          className="px-2"
        >
          <TableHeadCell>Command</TableHeadCell>
          <TableHeadCell>Keybinding</TableHeadCell>
          <TableHeadCell>When</TableHeadCell>
          <TableHeadCell>Source</TableHeadCell>
          <TableHeadCell>Actions</TableHeadCell>
        </TableHeader>

        {filteredCommands.length === 0 ? (
          <div className="ui-font ui-text-md flex items-center justify-center py-12 text-text-lighter">
            No keybindings found
          </div>
        ) : (
          filteredCommands.map((command) => {
            const binding = getKeybindingForCommand(command.id);
            return <KeybindingRow key={command.id} command={command} keybinding={binding} />;
          })
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <div className="ui-font ui-text-sm text-text-lighter">
          {filteredCommands.length} of {commands.length} keybindings
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="xs" onClick={handleResetAll}>
            Reset to Defaults
          </Button>
          <Button variant="secondary" size="xs" onClick={handleImport}>
            Import
          </Button>
          <Button variant="secondary" size="xs" onClick={handleExport}>
            Export
          </Button>
        </div>
      </div>
    </div>
  );
};
