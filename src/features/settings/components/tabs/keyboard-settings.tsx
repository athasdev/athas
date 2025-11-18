import { useMemo, useState } from "react";
import { KeybindingRow } from "@/features/keymaps/components/keybinding-row";
import { useKeymapStore } from "@/features/keymaps/stores/store";
import type { Keybinding } from "@/features/keymaps/types";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import Button from "@/ui/button";
import Input from "@/ui/input";

type FilterType = "all" | "user" | "default" | "extension";

export const KeyboardSettings = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");

  const keybindings = useKeymapStore.use.keybindings();
  const { resetToDefaults } = useKeymapStore.use.actions();

  const commands = useMemo(() => keymapRegistry.getAllCommands(), []);

  const filteredCommands = useMemo(() => {
    const query = searchQuery.toLowerCase();

    return commands.filter((command) => {
      const matchesSearch =
        !query ||
        command.title.toLowerCase().includes(query) ||
        command.id.toLowerCase().includes(query) ||
        (command.category && command.category.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      const binding = keybindings.find((kb) => kb.command === command.id);

      if (filterType === "all") return true;
      if (filterType === "user") return binding?.source === "user";
      if (filterType === "default") return !binding || binding.source === "default";
      if (filterType === "extension") return binding?.source === "extension";

      return true;
    });
  }, [commands, searchQuery, filterType, keybindings]);

  const handleResetAll = () => {
    if (confirm("Are you sure you want to reset all keybindings to defaults?")) {
      resetToDefaults();
    }
  };

  const handleExport = () => {
    const userBindings = keybindings.filter((kb) => kb.source === "user");
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
          alert("Invalid keybindings file format");
          return;
        }

        const { addKeybinding } = useKeymapStore.getState().actions;
        for (const binding of imported) {
          addKeybinding(binding);
        }

        alert(`Imported ${imported.length} keybindings`);
      } catch (error) {
        alert(`Failed to import keybindings: ${error}`);
      }
    };
    input.click();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Search and Filters */}
      <div className="mb-4 space-y-3">
        <Input
          placeholder="Search keybindings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full"
          aria-label="Search keybindings"
        />
        <div className="flex gap-2">
          <Button
            variant={filterType === "all" ? "default" : "ghost"}
            size="xs"
            onClick={() => setFilterType("all")}
          >
            All
          </Button>
          <Button
            variant={filterType === "user" ? "default" : "ghost"}
            size="xs"
            onClick={() => setFilterType("user")}
          >
            User
          </Button>
          <Button
            variant={filterType === "default" ? "default" : "ghost"}
            size="xs"
            onClick={() => setFilterType("default")}
          >
            Default
          </Button>
          <Button
            variant={filterType === "extension" ? "default" : "ghost"}
            size="xs"
            onClick={() => setFilterType("extension")}
          >
            Extension
          </Button>
        </div>
      </div>

      {/* Keybindings Table */}
      <div className="flex-1 overflow-y-auto">
        {/* Table Header */}
        <div className="sticky top-0 z-10 grid grid-cols-[2fr_200px_2fr_80px_100px] gap-4 border-b border-border bg-primary-bg px-2 py-2">
          <div className="text-xs font-medium text-text-lighter">Command</div>
          <div className="text-xs font-medium text-text-lighter">Keybinding</div>
          <div className="text-xs font-medium text-text-lighter">When</div>
          <div className="text-xs font-medium text-text-lighter">Source</div>
          <div className="text-xs font-medium text-text-lighter">Actions</div>
        </div>

        {/* Rows */}
        {filteredCommands.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-lighter">
            No keybindings found
          </div>
        ) : (
          filteredCommands.map((command) => {
            const binding = keybindings.find((kb) => kb.command === command.id);
            return <KeybindingRow key={command.id} command={command} keybinding={binding} />;
          })
        )}
      </div>

      {/* Footer Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <div className="text-xs text-text-lighter">
          {filteredCommands.length} of {commands.length} keybindings
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleResetAll}>
            Reset to Defaults
          </Button>
          <Button variant="ghost" size="sm" onClick={handleImport}>
            Import
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            Export
          </Button>
        </div>
      </div>
    </div>
  );
};
