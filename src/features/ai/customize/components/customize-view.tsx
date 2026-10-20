import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { McpServerDialog } from "@/features/ai/components/mcp/mcp-server-dialog";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  menuSeparator,
} from "@/ui/dropdown";
import {
  ArrowClockwiseIcon,
  ChatBubbleTextIcon,
  ChevronDownIcon,
  MagicWandIcon,
  PackageIcon,
  PlugsConnectedIcon,
  SettingsIcon,
} from "@/ui/icons";
import { SearchField } from "@/ui/search";
import { ToggleGroup } from "@/ui/toggle-group";
import { Workbench, WorkbenchContent, WorkbenchNavigation } from "@/ui/workbench";
import { useMcpServerEditor } from "../hooks/use-mcp-server-editor";
import { useSkillActions } from "../hooks/use-skill-actions";
import {
  buildCustomizeAgents,
  buildInstalledNavigationItems,
  parseCustomizeNavigationValue,
} from "../services/customize-catalog";
import { useCustomizeStore } from "../stores/customize.store";
import type { CustomizeSection, CustomizeTab } from "../types/customize.types";
import { AgentsSection } from "./agents-section";
import { CustomizeMark } from "./customize-mark";
import { ExtensionsSection } from "./extensions-section";
import { McpSection } from "./mcp-section";
import { SkillEditorDialog } from "./skill-editor-dialog";
import { SkillsSection } from "./skills-section";

const SECTION_ICONS: Record<CustomizeSection, ReactNode> = {
  mcp: <PlugsConnectedIcon />,
  agents: <ChatBubbleTextIcon />,
  skills: <MagicWandIcon />,
  extensions: <PackageIcon />,
};

const SECTIONS: ReadonlyArray<{
  id: CustomizeSection;
  label: string;
  description: string;
  searchPlaceholder: string;
  installedLabel: string;
}> = [
  {
    id: "mcp",
    label: "MCP servers",
    searchPlaceholder: "Search MCP servers",
    description: "Give agents tools from your apps and services",
    installedLabel: "Installed",
  },
  {
    id: "agents",
    label: "Agents",
    searchPlaceholder: "Search agents",
    description: "Coding agents that run in Athas with their own accounts",
    installedLabel: "Installed",
  },
  {
    id: "skills",
    label: "Skills",
    searchPlaceholder: "Search skills",
    description: "Reusable instructions you can hand to any agent",
    installedLabel: "Personal",
  },
  {
    id: "extensions",
    label: "Extensions",
    searchPlaceholder: "Search extensions",
    description: "Languages, themes and databases for the editor",
    installedLabel: "Installed",
  },
];

/**
 * Customize: one page for what extends the agents (MCP servers, agents, skills) and the editor
 * (extensions). Each page lists a catalog and what is installed, as rows in a two-column grid.
 */
export function CustomizeView() {
  const section = useCustomizeStore.use.section();
  const tabs = useCustomizeStore.use.tabs();
  const revealedItemId = useCustomizeStore.use.revealedItemId();
  const { setSection, setTab, reveal } = useCustomizeStore.use.actions();
  const [query, setQuery] = useState("");

  useEffect(() => setQuery(""), [section]);

  const showMcp = useCallback(() => setSection("mcp"), [setSection]);
  const mcpEditor = useMcpServerEditor(showMcp);
  const skillActions = useSkillActions();

  const agentSource = useAgentCatalogStore.use.agents();
  const codexSource = useAgentCatalogStore.use.codex();
  const refreshAgents = useAgentCatalogStore.use.actions().refresh;
  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);
  const codexInstalled = codexSource.data?.installed ?? false;
  const agents = useMemo(
    () => buildCustomizeAgents({ agents: agentSource.data ?? [], codexInstalled }),
    [agentSource.data, codexInstalled],
  );

  const installedItems = buildInstalledNavigationItems(mcpEditor.servers, agents);
  const page = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const tab = tabs[section];
  const showCatalog = () => setTab(section, "catalog");

  const navigationGroups = [
    {
      id: "pages",
      items: SECTIONS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: SECTION_ICONS[item.id],
      })),
    },
    {
      id: "installed",
      label: "Installed",
      items: installedItems.map((item) => ({
        id: item.id,
        label: item.label,
        icon: (
          <CustomizeMark brand={item.brand} size="inline" fallback={SECTION_ICONS[item.section]} />
        ),
      })),
    },
  ];

  const refresh = () => {
    void refreshAgents(true);
    void skillActions.reloadCatalog();
    void useExtensionStore.getState().actions.loadAvailableExtensions();
  };

  const addItems = [
    {
      id: "mcp",
      label: "MCP server…",
      icon: <PlugsConnectedIcon />,
      onClick: () => mcpEditor.openNew(),
    },
    { id: "skill", label: "Skill…", icon: <MagicWandIcon />, onClick: skillActions.create },
    menuSeparator("integrations-separator"),
    {
      id: "integrations",
      label: "Browse integrations",
      icon: <PackageIcon />,
      onClick: () => useBufferStore.getState().actions.openExtensionsBuffer(),
    },
  ];

  const actions = (
    <>
      <div className="w-56 max-w-full">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={page.searchPlaceholder}
          aria-label={page.searchPlaceholder}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
        />
      </div>
      <Button type="button" variant="ghost" iconOnly tooltip="Refresh" onClick={refresh}>
        <ArrowClockwiseIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        tooltip="AI settings"
        onClick={() => useUIState.getState().openSettings("ai-agents")}
      >
        <SettingsIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="accent" />}>
          Add
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItems items={addItems} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const body = {
    mcp: (
      <McpSection
        tab={tab}
        query={query}
        revealedItemId={revealedItemId}
        editor={mcpEditor}
        onShowCatalog={showCatalog}
      />
    ),
    agents: (
      <AgentsSection
        tab={tab}
        query={query}
        agents={agents}
        revealedItemId={revealedItemId}
        onShowCatalog={showCatalog}
      />
    ),
    skills: (
      <SkillsSection
        tab={tab}
        query={query}
        actions={skillActions}
        codexInstalled={codexInstalled}
        onShowCatalog={showCatalog}
      />
    ),
    extensions: <ExtensionsSection tab={tab} query={query} />,
  }[section];

  return (
    <Workbench data-customize-section={section}>
      <WorkbenchNavigation
        title="Integrations"
        search={null}
        groups={navigationGroups}
        value={section}
        onValueChange={(value) => {
          const target = parseCustomizeNavigationValue(value);
          if (!target) return;
          if (target.itemId) reveal(target.section, target.itemId);
          else setSection(target.section);
        }}
        ariaLabel="Customize pages"
      >
        <WorkbenchContent title={page.label} description={page.description} actions={actions}>
          <div className="mb-6">
            <ToggleGroup<CustomizeTab>
              value={tab}
              onValueChange={(next) => setTab(section, next)}
              ariaLabel={`${page.label} view`}
              options={[
                { value: "catalog", label: "Catalog" },
                { value: "installed", label: page.installedLabel },
              ]}
            />
          </div>
          {body}
        </WorkbenchContent>
      </WorkbenchNavigation>
      {mcpEditor.editor ? (
        <McpServerDialog
          initialDraft={mcpEditor.editor.draft}
          notice={mcpEditor.editor.notice}
          servers={mcpEditor.servers}
          onClose={mcpEditor.close}
          onSave={mcpEditor.save}
        />
      ) : null}
      {skillActions.editor ? (
        <SkillEditorDialog
          initialDraft={skillActions.editor.draft}
          isCatalogSkill={skillActions.editor.isCatalogSkill}
          onClose={skillActions.closeEditor}
          onSave={skillActions.save}
        />
      ) : null}
    </Workbench>
  );
}

export default CustomizeView;
