import { SearchIcon } from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import { IconThemeSelectorContent } from "@/features/command-palette/components/icon-theme-selector";
import { ThemeSelectorContent } from "@/features/command-palette/components/theme-selector";
import { LocalHistoryCommandContent } from "@/features/local-history/components/local-history-command";
import { OutlineCommandContent } from "@/features/outline/components/outline-command";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { vimCommands } from "@/features/vim/services/vim-commands";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import { getEffectiveShortcutsByCommand } from "@/features/keymaps/services/effective-keymaps";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  CommandTabs,
  useCommandListNavigation,
} from "@/ui/command";
import { Kbd } from "@/ui/kbd";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import Keybinding from "@/ui/keybinding";
import { commandPaletteOrder } from "../constants/command-palette-order";
import { useCommandPaletteContext } from "../hooks/use-command-palette-context";
import { attachCommandPaletteSession } from "../services/command-palette-session";
import type { CommandPaletteItem } from "../types/command-palette-item.types";
import type { CommandPaletteViewId } from "../types/view.types";
import { buildCommandPaletteItems } from "../utils/command-palette-items";
import {
  createExtensionCommandItems,
  createSettingsSearchItems,
  createVimCommandItems,
} from "../utils/command-palette-providers";
import {
  commandPaletteFilters,
  flattenCommandPaletteSections,
  getCommandPaletteSections,
  type CommandPaletteFilter,
} from "../utils/command-palette-results";
import { useActionsStore } from "../stores/action-history.store";
import { useCommandPaletteViews } from "../services/command-palette-view-registry";
import { useEffectiveTheme } from "@/features/settings/hooks/use-effective-theme";

interface CommandPaletteContentProps {
  commandPaletteInitialView: CommandPaletteViewId;
}

const CommandPaletteContent = ({ commandPaletteInitialView }: CommandPaletteContentProps) => {
  const setIsCommandPaletteVisible = useUIState((state) => state.setIsCommandPaletteVisible);
  const onClose = () => {
    setIsCommandPaletteVisible(false);
    setViewStack(["root"]);
  };

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<CommandPaletteFilter>("all");
  const [viewStack, setViewStack] = useState<CommandPaletteViewId[]>(["root"]);
  const [activeInitialView, setActiveInitialView] = useState<CommandPaletteViewId>("root");
  const resultsRef = useRef<HTMLDivElement>(null);
  const initialViewStack = useMemo<CommandPaletteViewId[]>(
    () => (commandPaletteInitialView === "root" ? ["root"] : ["root", commandPaletteInitialView]),
    [commandPaletteInitialView],
  );
  const renderedViewStack =
    activeInitialView !== commandPaletteInitialView ? initialViewStack : viewStack;
  const currentView = renderedViewStack[renderedViewStack.length - 1] || "root";

  const pushView = useCallback((view: CommandPaletteViewId) => {
    setQuery("");
    setViewStack((currentStack) => [...currentStack, view]);
  }, []);

  const popView = () => {
    setViewStack((currentStack) =>
      currentStack.length > 1 ? currentStack.slice(0, -1) : currentStack,
    );
  };

  useEffect(() => attachCommandPaletteSession({ pushView }), [pushView]);

  const handleThemeChange = useCallback((theme: string) => {
    const { settings, actions } = useSettingsStore.getState();
    const { updateSetting } = actions;
    if (settings.syncSystemTheme) {
      void updateSetting("syncSystemTheme", false).then(() => updateSetting("theme", theme));
      return;
    }

    void updateSetting("theme", theme);
  }, []);

  const handleIconThemeChange = useCallback((iconTheme: string) => {
    void useSettingsStore.getState().actions.updateSetting("iconTheme", iconTheme);
  }, []);

  const lastEnteredActions = useActionsStore.use.lastEnteredActionsStack();
  const { pushAction, clearStack } = useActionsStore.use.actions();
  const userKeybindings = useKeymapStore.use.keybindings();
  const keybindingPreset = useSettingsStore((state) => state.settings.keybindingPreset);
  const shortcutsByCommand = useMemo(
    () =>
      getEffectiveShortcutsByCommand({
        preset: keybindingPreset,
        registryKeybindings: keymapRegistry.getAllKeybindings(),
        userKeybindings,
      }),
    [keybindingPreset, userKeybindings],
  );
  const commandContext = useCommandPaletteContext();
  const { settings, activeBuffer } = commandContext;
  const effectiveTheme = useEffectiveTheme();
  const extensionCommands = useUIExtensionStore.use.commands();
  const extensionViews = useCommandPaletteViews();

  const paletteItems = buildCommandPaletteItems({
    commands: keymapRegistry.getAllCommands(),
    context: commandContext,
    order: commandPaletteOrder,
    providers: {
      "settings-search": () => createSettingsSearchItems(query),
      "extension-commands": () => createExtensionCommandItems(extensionCommands.values()),
      "vim-commands": () => createVimCommandItems(settings.vimMode, vimCommands),
    },
  });

  const commandSections = getCommandPaletteSections({
    actions: paletteItems,
    filter: activeFilter,
    query,
    recentActionIds: lastEnteredActions,
    showRecent: settings.coreFeatures.persistentCommands,
  });
  const paletteActions = flattenCommandPaletteSections(commandSections);
  const actionIndexes = new Map(paletteActions.map((action, index) => [action.id, index]));

  const runItem = (item: CommandPaletteItem) => {
    void item.run(onClose);
    pushAction(item.id);
  };

  const handleActionSelect = (index: number) => {
    const action = paletteActions[index];
    if (action) runItem(action);
  };

  const {
    selectedIndex,
    setSelectedIndex,
    onInputKeyDown: handleCommandKeyDown,
  } = useCommandListNavigation({
    itemCount: paletteActions.length,
    resetKey: `${currentView}:${activeFilter}:${query}`,
    onSelect: handleActionSelect,
  });

  // Reset state when visibility changes
  useEffect(() => {
    setQuery("");
    setActiveFilter("all");
    setActiveInitialView(commandPaletteInitialView);
    setViewStack(initialViewStack);
  }, [commandPaletteInitialView, initialViewStack]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(
      `[data-command-item-index="${selectedIndex}"]`,
    );
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selectedIndex, paletteActions.length]);

  const extensionView = extensionViews.get(currentView);

  return (
    <Command isVisible onClose={onClose}>
      {currentView === "color-theme" ? (
        <ThemeSelectorContent
          isActive={currentView === "color-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleThemeChange}
          currentTheme={settings.syncSystemTheme ? effectiveTheme : settings.theme}
        />
      ) : currentView === "icon-theme" ? (
        <IconThemeSelectorContent
          isActive={currentView === "icon-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleIconThemeChange}
          currentTheme={settings.iconTheme}
        />
      ) : currentView === "local-history" ? (
        <LocalHistoryCommandContent
          isActive={currentView === "local-history"}
          activeFilePath={
            activeBuffer?.type === "editor" && !activeBuffer.isVirtual ? activeBuffer.path : null
          }
          onBack={popView}
          onClose={onClose}
        />
      ) : currentView === "outline" ? (
        <OutlineCommandContent
          isActive={currentView === "outline"}
          onBack={popView}
          onClose={onClose}
        />
      ) : extensionView ? (
        extensionView.render({
          isActive: true,
          onBack: popView,
          onClose,
        })
      ) : (
        <>
          <CommandHeader
            onClose={onClose}
            onClear={settings.coreFeatures.persistentCommands ? clearStack : undefined}
          >
            <SearchIcon className="size-4 shrink-0 text-subtle-foreground" />
            <CommandInput
              value={query}
              onChange={setQuery}
              onKeyDown={handleCommandKeyDown}
              placeholder="Search commands and actions..."
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={
                paletteActions.length ? `command-palette-option-${selectedIndex}` : undefined
              }
            />
            <Kbd>Return</Kbd>
          </CommandHeader>

          <CommandTabs
            ariaLabel="Command categories"
            items={commandPaletteFilters.map((filter) => ({
              id: filter.id,
              label: filter.label,
              isActive: filter.id === activeFilter,
              onSelect: () => setActiveFilter(filter.id),
            }))}
          />

          <CommandList
            ref={resultsRef}
            id="command-palette-results"
            role="listbox"
            aria-label="Command results"
          >
            {paletteActions.length === 0 ? (
              <CommandEmpty>No commands found</CommandEmpty>
            ) : (
              commandSections.map((section) => (
                <section key={section.id} aria-labelledby={`command-section-${section.id}`}>
                  <div
                    id={`command-section-${section.id}`}
                    className="px-2.5 pt-2 pb-1 font-medium text-subtle-foreground ui-text-chrome"
                  >
                    {section.label}
                  </div>
                  {section.actions.map((action) => {
                    const index = actionIndexes.get(action.id) ?? 0;
                    const isSelected = index === selectedIndex;
                    const isRecent =
                      settings.coreFeatures.persistentCommands &&
                      lastEnteredActions.includes(action.id);
                    const binding = action.keybindingCommandId
                      ? shortcutsByCommand.get(action.keybindingCommandId)
                      : undefined;

                    return (
                      <CommandItemRow
                        key={action.id}
                        as="div"
                        id={`command-palette-option-${index}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={isSelected}
                        data-command-item-index={index}
                        onClick={() => runItem(action)}
                        onMouseMove={() => setSelectedIndex(index)}
                        isSelected={isSelected}
                        icon={action.icon}
                        contentLayout="stacked"
                        title={<SearchMatchHighlight text={action.label} query={query} />}
                        description={
                          <>
                            <span>{action.category}</span>
                            <span aria-hidden="true"> · </span>
                            <SearchMatchHighlight text={action.description} query={query} />
                          </>
                        }
                        accessory={
                          <>
                            {isRecent ? <CommandItemBadge>Recent</CommandItemBadge> : null}
                            {binding ? (
                              <Keybinding binding={binding} />
                            ) : isSelected ? (
                              <Kbd>Return</Kbd>
                            ) : null}
                          </>
                        }
                      />
                    );
                  })}
                </section>
              ))
            )}
          </CommandList>
        </>
      )}
    </Command>
  );
};

const CommandPalette = () => {
  const isVisible = useUIState((state) => state.isCommandPaletteVisible);
  const commandPaletteInitialView = useUIState((state) => state.commandPaletteInitialView);

  if (!isVisible) return null;

  return <CommandPaletteContent commandPaletteInitialView={commandPaletteInitialView} />;
};

CommandPaletteContent.displayName = "CommandPaletteContent";
CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
