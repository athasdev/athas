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
import EditorBreadcrumb from "@/features/editor/components/toolbar/breadcrumb";
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
import { ResourceCategoryNav, ResourcePageHeader } from "@/ui/resource";
import { buildExtensionCatalog } from "./build-extension-catalog";
import { ExtensionCatalogCard } from "./extension-catalog-card";
import { ExtensionCategoryIcon } from "./extension-catalog-icon";
import {
  EXTENSION_CATEGORIES,
  type ExtensionCategory,
  type UnifiedExtension,
} from "./extension-catalog-types";
import { buildExtensionContextMenuItems } from "./extension-context-menu-items";
import { ExtensionDetailView } from "./extension-detail-view";
import { ExtensionsBreadcrumb } from "./extensions-breadcrumb";
import { useExtensionCatalogActions } from "../hooks/use-extension-catalog-actions";

const EXTENSION_FILTERS = [{ id: "all", label: "All" }, ...EXTENSION_CATEGORIES] as const;
const EXTENSION_FILTER_IDS = new Set<string>(EXTENSION_FILTERS.map((filter) => filter.id));

function isExtensionFilter(value: string): value is "all" | ExtensionCategory {
  return EXTENSION_FILTER_IDS.has(value);
}

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
  const [loadingSkillPreviewId, setLoadingSkillPreviewId] = useState<string>();
  const [skillPreviewError, setSkillPreviewError] = useState<{
    skillId: string;
    message: string;
  }>();
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string>();
  const extensionContextMenu = useDropdownMenu<UnifiedExtension>();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const selectedExtensionEnabled = useExtensionStore((state) =>
    extensionId ? state.availableExtensions.get(extensionId)?.isEnabled : undefined,
  );
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
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
  const activeFilter = isExtensionFilter(settings.extensionsActiveTab)
    ? settings.extensionsActiveTab
    : "all";
  const activeCategory = EXTENSION_CATEGORIES.find((category) => category.id === activeFilter)?.id;
  const extensionCategories = EXTENSION_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    icon:
      filter.id === "all" ? (
        <Extensions weight="duotone" />
      ) : (
        <ExtensionCategoryIcon category={filter.id} />
      ),
  }));
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
  const selectedMarketplaceSkill = catalogExtension?.marketplaceSkill;
  const selectedSkillPreviewError =
    selectedMarketplaceSkill && skillPreviewError?.skillId === selectedMarketplaceSkill.id
      ? skillPreviewError.message
      : undefined;
  const installedCount = extensions.filter((extension) => extension.isInstalled).length;

  const handleOpenSkillPreview = useCallback(() => {
    if (
      !selectedMarketplaceSkill ||
      selectedMarketplaceSkill.content ||
      loadingSkillPreviewId === selectedMarketplaceSkill.id
    ) {
      return;
    }

    const skillId = selectedMarketplaceSkill.id;
    setLoadingSkillPreviewId(skillId);
    setSkillPreviewError(undefined);

    void resolveMarketplaceSkill(selectedMarketplaceSkill)
      .then((resolvedSkill) => {
        setMarketplaceSkills((skills) =>
          skills.map((skill) => (skill.id === resolvedSkill.id ? resolvedSkill : skill)),
        );
      })
      .catch(() => {
        setSkillPreviewError({
          skillId,
          message: "Could not load these skill instructions.",
        });
      })
      .finally(() => {
        setLoadingSkillPreviewId((currentSkillId) =>
          currentSkillId === skillId ? undefined : currentSkillId,
        );
      });
  }, [loadingSkillPreviewId, selectedMarketplaceSkill]);

  const isExtensionInstalling = (extension: UnifiedExtension) =>
    Boolean(availableExtensions.get(extension.id)?.isInstalling || isAgentInstalling(extension));
  const hasExtensionUpdate = (extension: UnifiedExtension) =>
    Boolean(extension.hasUpdate) ||
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
        initialSkillId={editingSkillId}
        initialView="editor"
        onClose={() => {
          setIsSkillsCommandOpen(false);
          setEditingSkillId(undefined);
        }}
        onSelectSkill={() => {
          setIsSkillsCommandOpen(false);
          setEditingSkillId(undefined);
        }}
      />
      <Dropdown
        isOpen={extensionContextMenu.isOpen}
        point={extensionContextMenu.position}
        items={extensionContextMenuItems}
        onClose={extensionContextMenu.close}
      />
    </>
  );

  const handleOpenCatalog = useCallback(() => {
    void updateSetting("extensionsActiveTab", "all");
    openExtensionsBuffer();
  }, [openExtensionsBuffer, updateSetting]);

  const handleOpenCategory = useCallback(
    (category: ExtensionCategory) => {
      void updateSetting("extensionsActiveTab", category);
      openExtensionsBuffer();
    },
    [openExtensionsBuffer, updateSetting],
  );

  if (extensionId) {
    return (
      <div className="@container/extensions font-sans flex h-full min-h-0 flex-col bg-background">
        <EditorBreadcrumb
          filePathOverride="Extensions"
          showPath={false}
          showDefaultActions={false}
          extraLeftContent={
            <ExtensionsBreadcrumb
              category={selectedExtension?.category}
              extension={selectedExtension}
              onOpenCatalog={handleOpenCatalog}
              onOpenCategory={handleOpenCategory}
            />
          }
        />
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
            onEditSkill={(skillId) => {
              setEditingSkillId(skillId);
              setIsSkillsCommandOpen(true);
            }}
            onOpenSkillPreview={handleOpenSkillPreview}
            isSkillPreviewLoading={loadingSkillPreviewId === selectedMarketplaceSkill?.id}
            skillPreviewError={selectedSkillPreviewError}
          />
        </ScrollArea>
        {overlays}
      </div>
    );
  }

  const isLoading = isLoadingSkills || isLoadingAgents;
  const resultLabel = `${visibleExtensions.length} extension${visibleExtensions.length === 1 ? "" : "s"}`;

  return (
    <div className="@container/extensions font-sans flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ResourcePageHeader
        breadcrumb={
          <EditorBreadcrumb
            filePathOverride="Extensions"
            showPath={false}
            showDefaultActions={false}
            extraLeftContent={
              <ExtensionsBreadcrumb
                category={activeCategory}
                onOpenCatalog={handleOpenCatalog}
                onOpenCategory={handleOpenCategory}
              />
            }
            rightContent={
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" />}>
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
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingSkillId(undefined);
                      setIsSkillsCommandOpen(true);
                    }}
                  >
                    <Brain />
                    Create Skill
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
            }
          />
        }
        search={
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search extensions..."
          />
        }
        status={
          <span role="status">
            {resultLabel}
            {updateCount > 0
              ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"}`
              : ` · ${installedCount} installed`}
          </span>
        }
        categories={
          <ResourceCategoryNav
            items={extensionCategories}
            value={activeFilter}
            onValueChange={(value) =>
              void updateSetting("extensionsActiveTab", value as Settings["extensionsActiveTab"])
            }
            ariaLabel="Extension categories"
          />
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-5 py-5 @max-[480px]/extensions:px-3 @max-[480px]/extensions:py-3">
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
                  : activeFilter === "skill"
                    ? {
                        label: "Create skill",
                        onClick: () => {
                          setEditingSkillId(undefined);
                          setIsSkillsCommandOpen(true);
                        },
                      }
                    : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 @min-[840px]/extensions:grid-cols-2">
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
