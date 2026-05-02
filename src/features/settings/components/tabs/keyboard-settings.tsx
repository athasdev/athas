import { AnimatePresence, motion } from "framer-motion";
import { MagnifyingGlass as Search } from "@phosphor-icons/react";
import {
  ArrowLeft,
  CirclesThree,
  Cube,
  DownloadSimple,
  Sliders,
  User,
} from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useMemo, useState } from "react";
import {
  KEYBINDING_TABLE_MIN_WIDTH_CLASS_NAME,
  KeybindingRow,
} from "@/features/keymaps/components/keybinding-row";
import {
  type KeybindingPreset,
  getKeybindingPresetCoverageReport,
  getKeybindingPresetDiffReport,
  keybindingPresetOptions,
} from "@/features/keymaps/defaults/keybinding-presets";
import { useKeymapStore } from "@/features/keymaps/stores/store";
import type { Keybinding } from "@/features/keymaps/types";
import { getEffectiveKeybindingForCommand } from "@/features/keymaps/utils/effective-keymaps";
import {
  createKeybindingsExportPayload,
  getExportableUserKeybindings,
  parseKeybindingsImportJson,
} from "@/features/keymaps/utils/keybinding-import-export";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useToast } from "@/features/layout/contexts/toast-context";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { SegmentedControl } from "@/ui/segmented-control";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { TableHeadCell, TableHeader } from "@/ui/table";
import { matchesSearchQuery } from "@/utils/search-match";
import { TypedConfirmAction } from "../typed-confirm-action";
import { SettingRow } from "../settings-section";

type FilterType = "all" | "user" | "default" | "preset" | "preset-changes" | "extension";

const editorStepTransition = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
  transition: { duration: 0.16, ease: "easeOut" as const },
};

const summaryStepTransition = {
  initial: { opacity: 0, x: -14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 14 },
  transition: { duration: 0.16, ease: "easeOut" as const },
};

export const KeyboardSettings = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [isEditingKeybindings, setIsEditingKeybindings] = useState(false);
  const { showToast } = useToast();
  const { settings, updateSetting } = useSettingsStore();

  const userKeybindings = useKeymapStore.use.keybindings();
  const { resetToDefaults } = useKeymapStore.use.actions();

  const commands = useMemo(() => keymapRegistry.getAllCommands(), []);
  const registryKeybindings = useMemo(() => keymapRegistry.getAllKeybindings(), []);

  const getKeybindingForCommand = (commandId: string): Keybinding | undefined =>
    getEffectiveKeybindingForCommand({
      commandId,
      preset: settings.keybindingPreset,
      registryKeybindings,
      userKeybindings,
    });

  const selectedPresetCoverage = useMemo(
    () => getKeybindingPresetCoverageReport(settings.keybindingPreset),
    [settings.keybindingPreset],
  );
  const selectedPresetDiff = useMemo(
    () => getKeybindingPresetDiffReport(settings.keybindingPreset),
    [settings.keybindingPreset],
  );

  const filteredCommands = useMemo(() => {
    const query = searchQuery.trim();

    return commands.filter((command) => {
      const binding = getKeybindingForCommand(command.id);
      const matchesSearch =
        !query ||
        matchesSearchQuery(query, [
          command.title,
          command.id,
          command.category ?? "",
          command.description ?? "",
          binding?.key ?? "",
          binding?.when ?? "",
        ]);

      if (!matchesSearch) return false;

      if (filterType === "all") return true;
      if (filterType === "user") return binding?.source === "user";
      if (filterType === "default") return !binding || binding.source === "default";
      if (filterType === "preset") return binding?.source === "preset";
      if (filterType === "preset-changes") {
        return selectedPresetDiff.changedCommandIds.includes(command.id);
      }
      if (filterType === "extension") return binding?.source === "extension";

      return true;
    });
  }, [
    commands,
    searchQuery,
    filterType,
    selectedPresetDiff.changedCommandIds,
    settings.keybindingPreset,
    userKeybindings,
    registryKeybindings,
  ]);

  const userOverrideCount = useMemo(
    () => userKeybindings.filter((binding) => binding.source === "user").length,
    [userKeybindings],
  );

  const handleResetAll = () => {
    resetToDefaults();
    showToast({ message: "Keybindings reset to defaults", type: "success" });
  };

  const handleExport = async () => {
    const userBindings = getExportableUserKeybindings(useKeymapStore.getState().keybindings);

    try {
      const targetPath = await save({
        defaultPath: "keybindings.json",
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!targetPath) {
        return;
      }

      const payload = createKeybindingsExportPayload({
        keybindingPreset: settings.keybindingPreset,
        keybindings: userBindings,
      });

      await writeTextFile(targetPath, JSON.stringify(payload, null, 2));
      showToast({ message: "Keybindings exported", type: "success" });
    } catch (error) {
      console.error("Failed to export keybindings:", error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error);

      showToast({
        message: `Failed to export keybindings: ${message}`,
        type: "error",
      });
    }
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
        const imported = parseKeybindingsImportJson(text);

        if (!imported) {
          showToast({ message: "Invalid keybindings file format", type: "error" });
          return;
        }

        if (imported.keybindingPreset) {
          await updateSetting("keybindingPreset", imported.keybindingPreset);
        }

        const { addKeybinding } = useKeymapStore.getState().actions;
        for (const binding of imported.keybindings) {
          addKeybinding(binding);
        }

        showToast({
          message: `Imported ${imported.keybindings.length} keybindings${
            imported.keybindingPreset ? " and preset" : ""
          }`,
          type: "success",
        });
      } catch (error) {
        showToast({ message: `Failed to import keybindings: ${error}`, type: "error" });
      }
    };
    input.click();
  };

  return (
    <div className="flex h-full flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {isEditingKeybindings ? (
          <motion.div
            key="keyboard-editor"
            className="flex h-full flex-col"
            {...editorStepTransition}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setIsEditingKeybindings(false)}
                className="gap-1.5"
              >
                <ArrowLeft size={14} weight="duotone" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <TypedConfirmAction actionLabel="Reset to Defaults" onConfirm={handleResetAll} />
                <Button variant="default" size="xs" onClick={handleImport}>
                  Import
                </Button>
                <Button variant="default" size="xs" onClick={() => void handleExport()}>
                  Export
                </Button>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <Input
                placeholder="Search keybindings..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                leftIcon={Search}
                size="sm"
                containerClassName="w-full"
              />
            </div>

            <div className="mb-3 overflow-x-auto">
              <SegmentedControl
                value={filterType}
                onChange={(value) => setFilterType(value as FilterType)}
                className="inline-flex h-auto min-w-max max-w-full flex-wrap items-stretch gap-1 overflow-visible self-start rounded-xl border border-border/60 bg-secondary-bg/40 p-1"
                options={[
                  {
                    value: "all",
                    label: "All",
                    icon: <CirclesThree size={14} weight="duotone" />,
                  },
                  {
                    value: "user",
                    label: "User",
                    icon: <User size={14} weight="duotone" />,
                  },
                  {
                    value: "default",
                    label: "Default",
                    icon: <Sliders size={14} weight="duotone" />,
                  },
                  {
                    value: "preset",
                    label: "Preset",
                    icon: <DownloadSimple size={14} weight="duotone" />,
                  },
                  {
                    value: "preset-changes",
                    label: "Preset Changes",
                    icon: <DownloadSimple size={14} weight="fill" />,
                  },
                  {
                    value: "extension",
                    label: "Extension",
                    icon: <Cube size={14} weight="duotone" />,
                  },
                ]}
              />
            </div>

            <div className="flex-1 overflow-hidden">
              <div className="h-full overflow-x-auto overflow-y-auto">
                <div className={KEYBINDING_TABLE_MIN_WIDTH_CLASS_NAME}>
                  <TableHeader
                    gridCols="minmax(220px,2fr) minmax(156px,1fr) minmax(128px,1.25fr) 72px 92px"
                    className="gap-3 px-1.5 py-1"
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
                      return (
                        <KeybindingRow key={command.id} command={command} keybinding={binding} />
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="keyboard-summary" className="space-y-2" {...summaryStepTransition}>
            <SettingRow
              label="Vim Mode"
              description="Enable vim keybindings and commands"
              onReset={() => updateSetting("vimMode", getDefaultSetting("vimMode"))}
              canReset={settings.vimMode !== getDefaultSetting("vimMode")}
            >
              <Switch
                checked={settings.vimMode}
                onChange={(checked) => updateSetting("vimMode", checked)}
                size="sm"
              />
            </SettingRow>

            <SettingRow
              label="Keybinding Preset"
              description="Apply a base shortcut style before your custom overrides."
              onReset={() =>
                updateSetting("keybindingPreset", getDefaultSetting("keybindingPreset"))
              }
              canReset={settings.keybindingPreset !== getDefaultSetting("keybindingPreset")}
            >
              <Select
                value={settings.keybindingPreset}
                onChange={(value) => updateSetting("keybindingPreset", value as KeybindingPreset)}
                options={keybindingPresetOptions}
                size="sm"
                variant="outline"
                searchable
                searchableTrigger="input"
                aria-label="Keybinding preset"
              />
            </SettingRow>

            {settings.keybindingPreset !== "none" && !selectedPresetCoverage.isComplete ? (
              <div className="ui-font ui-text-sm rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-warning">
                This preset is incomplete. {selectedPresetCoverage.missingCommandIds.length}{" "}
                built-in command
                {selectedPresetCoverage.missingCommandIds.length === 1 ? " is" : "s are"} still
                missing preset coverage.
              </div>
            ) : null}

            <SettingRow label="Edit Keybindings" description="Customize shortcuts individually.">
              <Button variant="default" size="xs" onClick={() => setIsEditingKeybindings(true)}>
                Open Editor
              </Button>
            </SettingRow>
            {userOverrideCount > 0 ? (
              <div className="ui-font ui-text-sm px-1 text-text-lighter">
                {userOverrideCount} user override{userOverrideCount === 1 ? "" : "s"} currently
                saved.
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
