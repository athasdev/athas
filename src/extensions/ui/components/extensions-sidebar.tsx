import {
  BrainIcon as Brain,
  PackageIcon as Package,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { SkillsCommand } from "@/features/ai/components/skills/skills-command";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGenerateStore } from "@/features/generate/stores/generate.store";
import { hasMarketplaceSkillUpdate, loadMarketplaceSkills } from "@/features/ai/lib/skill-library";
import type { MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  Dropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import {
  SidebarHeaderIconButton,
  SidebarPanel,
  SidebarSearchPopover,
  SidebarSection,
  SidebarTitleBar,
} from "@/ui/sidebar";

import { buildExtensionCatalog } from "./build-extension-catalog";
import { EXTENSION_CATEGORIES, type UnifiedExtension } from "./extension-catalog-types";
import { buildExtensionContextMenuItems } from "./extension-context-menu-items";
import { ExtensionDetailView } from "./extension-detail-view";
import { ExtensionListItem } from "./extension-list-item";
import { useExtensionCatalogActions } from "../hooks/use-extension-catalog-actions";

const ExtensionsView = ({ extensionId }: { extensionId?: string }) => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiSkills: state.settings.aiSkills,
      iconTheme: state.settings.iconTheme,
      theme: state.settings.theme,
    })),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const extensionContextMenu = useDropdownMenu<UnifiedExtension>();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const openExtensionBuffer = useBufferStore.use.actions().openExtensionBuffer;
  const activeExtensionId = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extension" ? activeBuffer.extensionId : null;
  });

  const {
    agents,
    isLoadingAgents,
    isExtensionInstalling: isAgentInstalling,
    handleActivateExtension,
    handleDeactivateExtension,
    handleUseAppearance,
    handleToggle,
    handleUninstall,
    handleUpdate,
    handleResetSkillOverride,
  } = useExtensionCatalogActions(settings);

  const extensions = useMemo(
    () =>
      buildExtensionCatalog({
        availableExtensions,
        agents,
        marketplaceSkills,
        aiSkills: settings.aiSkills,
        selectedThemeId: settings.theme,
        selectedIconThemeId: settings.iconTheme,
      }),
    [
      agents,
      availableExtensions,
      marketplaceSkills,
      settings.aiSkills,
      settings.iconTheme,
      settings.theme,
    ],
  );

  useEffect(() => {
    setIsLoadingSkills(true);
    void loadMarketplaceSkills()
      .then(setMarketplaceSkills)
      .finally(() => setIsLoadingSkills(false));
  }, []);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMatchedExtensions = extensions.filter((extension) => {
    const matchesSearch =
      !normalizedSearchQuery ||
      extension.name.toLowerCase().includes(normalizedSearchQuery) ||
      extension.description.toLowerCase().includes(normalizedSearchQuery) ||
      extension.publisher?.toLowerCase().includes(normalizedSearchQuery) ||
      extension.contributionSummary?.some((item) =>
        item.toLowerCase().includes(normalizedSearchQuery),
      );
    return matchesSearch;
  });
  const categorySections = EXTENSION_CATEGORIES.map((category) => ({
    ...category,
    extensions: searchMatchedExtensions.filter((extension) => extension.category === category.id),
  })).filter((section) => section.extensions.length > 0);
  const selectedExtension = extensionId
    ? (extensions.find((extension) => extension.id === extensionId) ?? null)
    : null;
  const installedCount = extensions.filter((extension) => extension.isInstalled).length;

  const isExtensionInstalling = (extension: UnifiedExtension) =>
    Boolean(availableExtensions.get(extension.id)?.isInstalling || isAgentInstalling(extension));

  const hasExtensionUpdate = (extension: UnifiedExtension) =>
    extensionsWithUpdates.has(extension.id) ||
    Boolean(
      extension.skill &&
      extension.marketplaceSkill &&
      hasMarketplaceSkillUpdate(extension.skill, extension.marketplaceSkill),
    );
  const updateCount = extensions.filter((extension) => hasExtensionUpdate(extension)).length;

  const handleExtensionContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, extension: UnifiedExtension) => {
      extensionContextMenu.open(event, extension);
    },
    [extensionContextMenu],
  );

  const extensionContextMenuItems = buildExtensionContextMenuItems({
    extension: extensionContextMenu.data,
    settings,
    isExtensionInstalling,
    hasExtensionUpdate,
    handleActivateExtension,
    handleDeactivateExtension,
    handleUseAppearance,
    handleToggle,
    handleUpdate,
    handleResetSkillOverride,
    handleUninstall,
  });

  const extensionDetail = (
    <ExtensionDetailView
      extension={selectedExtension}
      settings={settings}
      isInstalling={isExtensionInstalling}
      hasUpdate={hasExtensionUpdate}
      onUseAppearance={handleUseAppearance}
      onToggle={handleToggle}
      onUninstall={handleUninstall}
      onUpdate={handleUpdate}
      onDeactivate={handleDeactivateExtension}
      onResetSkillOverride={handleResetSkillOverride}
    />
  );

  const overlays = (
    <>
      <SkillsCommand
        isOpen={isSkillsCommandOpen}
        initialView="editor"
        onClose={() => setIsSkillsCommandOpen(false)}
        onSelectSkill={() => setIsSkillsCommandOpen(false)}
      />
      <Dropdown
        isOpen={extensionContextMenu.isOpen}
        point={extensionContextMenu.position}
        items={extensionContextMenuItems}
        onClose={extensionContextMenu.close}
      />
    </>
  );

  if (extensionId) {
    return (
      <div className="font-sans flex h-full min-h-0 flex-col bg-background">
        <ScrollArea className="min-h-0 flex-1">{extensionDetail}</ScrollArea>
        {overlays}
      </div>
    );
  }

  return (
    <>
      <SidebarPanel className="font-sans select-none">
        <SidebarTitleBar title="Extensions">
          <SidebarSearchPopover
            value={searchQuery}
            onChange={setSearchQuery}
            open={isSearchOpen}
            onOpenChange={setIsSearchOpen}
            aria-label="Search extensions"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarHeaderIconButton tooltip="Add" tooltipSide="bottom" aria-label="Add" />
              }
            >
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setIsSearchOpen(true)}>
                <Package />
                Add Extension
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsSkillsCommandOpen(true)}>
                <Brain />
                Add Skill
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => useGenerateStore.getState().actions.openExtensionGeneration()}
              >
                <Sparkles />
                Generate Extension
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarTitleBar>

        <div className="px-4 pb-1 text-subtle-foreground ui-text-sm">
          {searchMatchedExtensions.length} extension
          {searchMatchedExtensions.length === 1 ? "" : "s"}
          {updateCount > 0
            ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"}`
            : installedCount > 0
              ? ` · ${installedCount} installed`
              : ""}
        </div>

        <ScrollArea className="min-h-0 flex-1" contentClassName="px-2 py-2">
          {isLoadingSkills || isLoadingAgents ? (
            <EmptyState
              layout="sidebar"
              message={<Spinner label="Loading extensions" showLabel compact />}
            />
          ) : searchMatchedExtensions.length === 0 ? (
            <EmptyState layout="sidebar" message="No extensions found." />
          ) : (
            <div className="overflow-x-hidden">
              {categorySections.map((section) => (
                <SidebarSection
                  key={section.id}
                  title={section.label}
                  count={section.extensions.length}
                  forceExpanded={normalizedSearchQuery.length > 0}
                >
                  {section.extensions.map((extension) => (
                    <ExtensionListItem
                      key={extension.id}
                      extension={extension}
                      selected={activeExtensionId === extension.id}
                      onSelect={() => openExtensionBuffer(extension.id, extension.name)}
                      onContextMenu={handleExtensionContextMenu}
                      isInstalling={isExtensionInstalling(extension)}
                      hasUpdate={hasExtensionUpdate(extension)}
                      hasRuntimeIssue={Boolean(extension.runtimeIssues?.length)}
                    />
                  ))}
                </SidebarSection>
              ))}
            </div>
          )}
        </ScrollArea>
      </SidebarPanel>
      {overlays}
    </>
  );
};

export const ExtensionsSidebar = () => <ExtensionsView />;

export const ExtensionDetails = ({ extensionId }: { extensionId: string }) => (
  <ExtensionsView extensionId={extensionId} />
);
