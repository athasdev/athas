import {
  BrainIcon as Brain,
  ExtensionsIcon as Extensions,
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
import {
  hasMarketplaceSkillUpdate,
  loadMarketplaceSkills,
  resolveMarketplaceSkill,
} from "@/features/ai/lib/skill-library";
import type { MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { Settings } from "@/features/settings/types/settings.types";
import {
  Dropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/ui/dropdown";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { SearchInput } from "@/ui/search";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { buildExtensionCatalog } from "./build-extension-catalog";
import { ExtensionCatalogCard } from "./extension-catalog-card";
import { EXTENSION_CATEGORIES, type UnifiedExtension } from "./extension-catalog-types";
import { buildExtensionContextMenuItems } from "./extension-context-menu-items";
import { ExtensionDetailView } from "./extension-detail-view";
import { useExtensionCatalogActions } from "../hooks/use-extension-catalog-actions";

const EXTENSION_FILTERS = [{ id: "all", label: "All" }, ...EXTENSION_CATEGORIES] as const;
const EXTENSION_FILTER_IDS = new Set<string>(EXTENSION_FILTERS.map((filter) => filter.id));

function ExtensionsSurface({ extensionId }: { extensionId?: string }) {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiSkills: state.settings.aiSkills,
      extensionsActiveTab: state.settings.extensionsActiveTab,
      iconTheme: state.settings.iconTheme,
      theme: state.settings.theme,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [searchQuery, setSearchQuery] = useState("");
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const extensionContextMenu = useDropdownMenu<UnifiedExtension>();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const selectedExtensionEnabled = useExtensionStore((state) =>
    extensionId ? state.availableExtensions.get(extensionId)?.isEnabled : undefined,
  );
  const openExtensionBuffer = useBufferStore.use.actions().openExtensionBuffer;

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
    let isCurrent = true;
    setIsLoadingSkills(true);
    void loadMarketplaceSkills()
      .then(async (skills) => {
        const installedSourceIds = new Set(
          settings.aiSkills
            .filter((skill) => skill.source === "marketplace")
            .map((skill) => skill.sourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId)),
        );
        return Promise.all(
          skills.map((skill) =>
            installedSourceIds.has(skill.id)
              ? resolveMarketplaceSkill(skill).catch(() => skill)
              : skill,
          ),
        );
      })
      .then((skills) => {
        if (isCurrent) setMarketplaceSkills(skills);
      })
      .finally(() => {
        if (isCurrent) setIsLoadingSkills(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [settings.aiSkills]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const activeFilter = EXTENSION_FILTER_IDS.has(settings.extensionsActiveTab)
    ? settings.extensionsActiveTab
    : "all";
  const visibleExtensions = extensions.filter((extension) => {
    const matchesCategory = activeFilter === "all" || extension.category === activeFilter;
    const matchesSearch =
      !normalizedSearchQuery ||
      extension.name.toLowerCase().includes(normalizedSearchQuery) ||
      extension.description.toLowerCase().includes(normalizedSearchQuery) ||
      extension.publisher?.toLowerCase().includes(normalizedSearchQuery) ||
      extension.contributionSummary?.some((item) =>
        item.toLowerCase().includes(normalizedSearchQuery),
      );
    return matchesCategory && matchesSearch;
  });
  const catalogExtension = extensionId
    ? (extensions.find((extension) => extension.id === extensionId) ?? null)
    : null;
  const selectedExtension =
    catalogExtension && selectedExtensionEnabled !== undefined
      ? { ...catalogExtension, isEnabled: selectedExtensionEnabled }
      : catalogExtension;
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
        <ScrollArea className="min-h-0 flex-1">
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
        </ScrollArea>
        {overlays}
      </div>
    );
  }

  const isLoading = isLoadingSkills || isLoadingAgents;
  const resultLabel = `${visibleExtensions.length} extension${visibleExtensions.length === 1 ? "" : "s"}`;

  return (
    <div className="font-sans flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0">
        <div className="mx-auto w-full max-w-6xl px-5 pt-5 pb-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-foreground">
              <Extensions className="size-5" weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold text-foreground ui-text-2xl">Extensions</h1>
              <p className="mt-0.5 text-subtle-foreground ui-text-base">
                Add languages, themes, tools, integrations, and AI capabilities to Athas.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="accent" size="sm" />}>
                <Plus />
                Add
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => {
                    setSearchQuery("");
                    void updateSetting("extensionsActiveTab", "all");
                  }}
                >
                  <Package />
                  Browse Extensions
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
          </div>

          <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search extensions..."
              className="min-w-64 max-w-xl"
            />
            <div className="ml-auto shrink-0 text-subtle-foreground ui-text-sm" role="status">
              {resultLabel}
              {updateCount > 0
                ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"}`
                : ` · ${installedCount} installed`}
            </div>
          </div>

          <Tabs
            className="mt-3"
            value={activeFilter}
            onValueChange={(value) =>
              void updateSetting("extensionsActiveTab", value as Settings["extensionsActiveTab"])
            }
          >
            <TabsList variant="bare" className="max-w-full flex-wrap justify-start">
              {EXTENSION_FILTERS.map((filter) => (
                <TabsTrigger key={filter.id} value={filter.id} size="xs">
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-5 py-5">
          {isLoading ? (
            <EmptyState
              className="min-h-64"
              icon={<Extensions />}
              title="Loading extensions"
              message={<Spinner label="Loading extensions" showLabel compact />}
            />
          ) : visibleExtensions.length === 0 ? (
            <EmptyState
              className="min-h-64"
              icon={<Package />}
              title="No extensions found"
              message="Try another search or category."
              action={
                normalizedSearchQuery
                  ? { label: "Clear search", onClick: () => setSearchQuery("") }
                  : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visibleExtensions.map((extension) => (
                <ExtensionCatalogCard
                  key={extension.id}
                  extension={extension}
                  onSelect={() => openExtensionBuffer(extension.id, extension.name)}
                  onContextMenu={handleExtensionContextMenu}
                  isInstalling={isExtensionInstalling(extension)}
                  hasUpdate={hasExtensionUpdate(extension)}
                  hasRuntimeIssue={Boolean(extension.runtimeIssues?.length)}
                />
              ))}
            </div>
          )}
        </main>
      </ScrollArea>
      {overlays}
    </div>
  );
}

export const ExtensionsView = () => <ExtensionsSurface />;

export const ExtensionDetails = ({ extensionId }: { extensionId: string }) => (
  <ExtensionsSurface extensionId={extensionId} />
);
