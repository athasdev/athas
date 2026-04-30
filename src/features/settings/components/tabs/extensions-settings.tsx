import {
  SquaresFour as Blocks,
  Plus,
  ArrowClockwise as RefreshCw,
  MagnifyingGlass as Search,
} from "@phosphor-icons/react";
import {
  Brain,
  Database,
  Package,
  PaintBrush,
  PuzzlePiece,
  TextT,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { CreateExtensionWizard } from "@/extensions/ui/components/create-extension-wizard";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import type { ExtensionRuntimeIssue } from "@/extensions/registry/extension-store-types";
import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { uiExtensionHost } from "@/extensions/ui/services/ui-extension-host";
import { SkillsCommand } from "@/features/ai/components/skills/skills-command";
import {
  createSkillFromMarketplace,
  hasMarketplaceSkillUpdate,
  hasSkillLocalOverride,
  isMarketplaceSkillInstalled,
  loadMarketplaceSkills,
  resetSkillLocalOverride,
  updateSkillFromMarketplace,
} from "@/features/ai/lib/skill-library";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { SegmentedControl } from "@/ui/segmented-control";
import { ProActionButton } from "../pro-action-button";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database" | "ui" | "skill";
  isInstalled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
  isBundled?: boolean;
  runtimeIssues?: ExtensionRuntimeIssue[];
  skill?: AIChatSkill;
  marketplaceSkill?: MarketplaceSkill;
}

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "language", label: "Languages", icon: TextT },
  { id: "theme", label: "Themes", icon: PaintBrush },
  { id: "icon-theme", label: "Icon Themes", icon: Package },
  { id: "database", label: "Databases", icon: Database },
  { id: "skill", label: "Skills", icon: Brain },
  { id: "ui", label: "Custom", icon: PuzzlePiece },
] as const;

const getCategoryLabel = (category: UnifiedExtension["category"]) => {
  switch (category) {
    case "language":
      return "Language";
    case "theme":
      return "Theme";
    case "icon-theme":
      return "Icon Theme";
    case "database":
      return "Database";
    case "skill":
      return "Skill";
    case "ui":
      return "Custom";
    default:
      return category;
  }
};

const ExtensionRow = ({
  extension,
  onToggle,
  onResetOverride,
  onUpdate,
  isInstalling,
  hasUpdate,
  hasLocalOverride,
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  onResetOverride?: () => void;
  onUpdate?: () => void;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasLocalOverride?: boolean;
  hasRuntimeIssue?: boolean;
}) => {
  const installLabel = extension.category === "skill" ? "Add" : "Install";
  const uninstallLabel = extension.category === "skill" ? "Remove" : "Uninstall";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-1 py-3 transition-colors hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="ui-font ui-text-md text-text">{extension.name}</span>
          <Badge variant="default" size="compact" shape="pill">
            {getCategoryLabel(extension.category)}
          </Badge>
          {extension.version && (
            <span className="ui-font ui-text-sm text-text-lighter">v{extension.version}</span>
          )}
          {hasLocalOverride && (
            <Badge
              variant="default"
              size="compact"
              shape="pill"
              className="border-warning/25 bg-warning/10 text-warning"
            >
              Local override
            </Badge>
          )}
        </div>
        <p className="ui-font ui-text-sm text-text-lighter">{extension.description}</p>
        {extension.runtimeIssues && extension.runtimeIssues.length > 0 && (
          <div className="mt-1 rounded-lg border border-error/20 bg-error/8 px-2 py-1.5">
            <div className="ui-font ui-text-sm flex items-start gap-1.5 text-error">
              <WarningCircle className="mt-0.5 shrink-0" size={14} weight="duotone" />
              <span>{extension.runtimeIssues[0].message}</span>
            </div>
          </div>
        )}
        <div className="ui-font ui-text-sm mt-1 flex items-center gap-2 text-text-lighter">
          {extension.publisher && <span>by {extension.publisher}</span>}
          {extension.publisher && extension.extensions && extension.extensions.length > 0 && (
            <span>·</span>
          )}
          {extension.extensions && extension.extensions.length > 0 && (
            <span>
              {extension.extensions
                .slice(0, 5)
                .map((ext) => `.${ext}`)
                .join(" ")}
              {extension.extensions.length > 5 && ` +${extension.extensions.length - 5}`}
            </span>
          )}
        </div>
      </div>
      {extension.isBundled ? (
        <Badge variant="accent" size="compact" className="shrink-0 rounded-full">
          Built-in
        </Badge>
      ) : isInstalling ? (
        <span className="ui-font ui-text-sm shrink-0 text-accent">Installing</span>
      ) : extension.isInstalled ? (
        <div className="flex shrink-0 items-center gap-2">
          {(hasUpdate || hasRuntimeIssue) && onUpdate && (
            <Button onClick={onUpdate} variant="default" size="xs" tooltip="Update available">
              {hasRuntimeIssue ? "Reinstall" : "Update"}
            </Button>
          )}
          {hasLocalOverride && onResetOverride && (
            <Button
              onClick={onResetOverride}
              variant="secondary"
              size="xs"
              tooltip="Reset to marketplace version"
            >
              Reset
            </Button>
          )}
          <Button
            onClick={onToggle}
            variant="danger"
            size="xs"
            className="border-error/35 bg-error/10 text-error hover:border-error/45 hover:bg-error/15 hover:text-error"
            tooltip={uninstallLabel}
          >
            {uninstallLabel}
          </Button>
        </div>
      ) : (
        <Button
          onClick={onToggle}
          variant="default"
          size="xs"
          className="shrink-0"
          tooltip={installLabel}
        >
          {installLabel}
        </Button>
      )}
    </div>
  );
};

export const ExtensionsSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const setActiveView = useUIState((state) => state.setActiveView);
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const { showToast } = useToast();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const { installExtension, uninstallExtension, updateExtension } = useExtensionStore.use.actions();
  const generatedUIExtensions = useUIExtensionStore.use.extensions();

  const loadAllExtensions = useCallback(() => {
    const allExtensions: UnifiedExtension[] = [];

    for (const [, ext] of availableExtensions) {
      if (ext.manifest.languages && ext.manifest.languages.length > 0) {
        const lang = ext.manifest.languages[0];
        const isBundled = !ext.manifest.installation;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "language",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          extensions: lang.extensions.map((e: string) => e.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: !isBundled,
          isBundled,
          runtimeIssues: ext.runtimeIssues,
        });
      }
    }

    themeRegistry.getAllThemes().forEach((theme) => {
      allExtensions.push({
        id: theme.id,
        name: theme.name,
        description: theme.description || `${theme.category} theme`,
        category: "theme",
        isInstalled: true,
        version: "1.0.0",
      });
    });

    iconThemeRegistry.getAllThemes().forEach((iconTheme) => {
      allExtensions.push({
        id: iconTheme.id,
        name: iconTheme.name,
        description: iconTheme.description || `${iconTheme.name} icon theme`,
        category: "icon-theme",
        isInstalled: true,
        version: "1.0.0",
      });
    });

    allExtensions.push({
      id: "sqlite-viewer",
      name: "SQLite Viewer",
      description: "View and query SQLite databases",
      category: "database",
      isInstalled: true,
      version: "1.0.0",
    });

    for (const skill of settings.aiSkills) {
      const preview = skill.content.trim().replace(/\s+/g, " ").slice(0, 160);
      const marketplaceSkill =
        skill.source === "marketplace"
          ? marketplaceSkills.find(
              (candidate) => candidate.id === skill.sourceId || candidate.id === skill.id,
            )
          : undefined;

      allExtensions.push({
        id: skill.id,
        name: skill.title,
        description: skill.description || preview || "Reusable AI chat instructions",
        category: "skill",
        isInstalled: true,
        version: skill.version || (skill.source === "marketplace" ? undefined : "Local"),
        publisher: skill.author || (skill.source === "marketplace" ? "Marketplace" : "You"),
        isMarketplace: skill.source === "marketplace",
        skill,
        marketplaceSkill,
      });
    }

    for (const skill of marketplaceSkills) {
      if (isMarketplaceSkillInstalled(settings.aiSkills, skill.id)) {
        continue;
      }

      allExtensions.push({
        id: skill.id,
        name: skill.title,
        description: skill.description,
        category: "skill",
        isInstalled: false,
        version: skill.version,
        publisher: skill.author,
        isMarketplace: true,
        marketplaceSkill: skill,
      });
    }

    for (const [, ext] of availableExtensions) {
      if (ext.manifest.categories.includes("UI")) {
        const isBundled = !ext.manifest.installation;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "ui",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: !isBundled,
          isBundled,
          runtimeIssues: ext.runtimeIssues,
        });
      }
    }

    for (const [, ext] of generatedUIExtensions) {
      if (allExtensions.some((existing) => existing.id === ext.extensionId)) {
        continue;
      }

      allExtensions.push({
        id: ext.extensionId,
        name: ext.name || ext.extensionId.replace(/^user\./, ""),
        description: ext.description || "Generated UI extension",
        category: "ui",
        isInstalled: ext.state === "active" || ext.state === "loading",
        version: "Local",
        publisher: "You",
        isMarketplace: false,
        isBundled: false,
      });
    }

    setExtensions(allExtensions);
  }, [availableExtensions, generatedUIExtensions, marketplaceSkills, settings.aiSkills]);

  useEffect(() => {
    loadAllExtensions();
  }, [settings.theme, settings.iconTheme, loadAllExtensions]);

  useEffect(() => {
    setIsLoadingSkills(true);
    void loadMarketplaceSkills()
      .then(setMarketplaceSkills)
      .finally(() => setIsLoadingSkills(false));
  }, []);

  const handleUpdate = async (extension: UnifiedExtension) => {
    if (extension.category === "skill") {
      if (!extension.skill || !extension.marketplaceSkill) return;

      try {
        const updatedSkill = updateSkillFromMarketplace(
          extension.skill,
          extension.marketplaceSkill,
        );
        await updateSetting(
          "aiSkills",
          settings.aiSkills.map((skill) =>
            skill.id === extension.skill?.id ? updatedSkill : skill,
          ),
        );
        showToast({
          message: updatedSkill.localOverride
            ? `${extension.name} updated, local override kept`
            : `${extension.name} updated successfully`,
          type: "success",
          duration: 3000,
        });
      } catch (error) {
        console.error(`Failed to update ${extension.name}:`, error);
        showToast({
          message: `Failed to update ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
          duration: 5000,
        });
      }
      return;
    }

    try {
      await updateExtension(extension.id);
      showToast({
        message: `${extension.name} updated successfully`,
        type: "success",
        duration: 3000,
      });
    } catch (error) {
      console.error(`Failed to update ${extension.name}:`, error);
      showToast({
        message: `Failed to update ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        type: "error",
        duration: 5000,
      });
    }
  };

  const handleResetSkillOverride = async (extension: UnifiedExtension) => {
    if (extension.category !== "skill" || !extension.skill) return;

    try {
      await updateSetting(
        "aiSkills",
        settings.aiSkills.map((skill) =>
          skill.id === extension.skill?.id ? resetSkillLocalOverride(skill) : skill,
        ),
      );
      showToast({
        message: `${extension.name} reset to marketplace version`,
        type: "success",
        duration: 3000,
      });
    } catch (error) {
      console.error(`Failed to reset ${extension.name}:`, error);
      showToast({
        message: `Failed to reset ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        type: "error",
        duration: 5000,
      });
    }
  };

  const handleToggle = async (extension: UnifiedExtension) => {
    if (extension.category === "skill") {
      try {
        if (extension.isInstalled) {
          const sourceId = extension.skill?.sourceId;
          await updateSetting(
            "aiSkills",
            settings.aiSkills.filter(
              (skill) => skill.id !== extension.id && (!sourceId || skill.sourceId !== sourceId),
            ),
          );
          showToast({
            message: `${extension.name} removed successfully`,
            type: "success",
            duration: 3000,
          });
          return;
        }

        if (!extension.marketplaceSkill) {
          return;
        }

        await updateSetting("aiSkills", [
          createSkillFromMarketplace(extension.marketplaceSkill),
          ...settings.aiSkills,
        ]);
        showToast({
          message: `${extension.name} added successfully`,
          type: "success",
          duration: 3000,
        });
      } catch (error) {
        console.error(`Failed to update ${extension.name}:`, error);
        showToast({
          message: `Failed to update ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
          duration: 5000,
        });
      }
      return;
    }

    if (extension.isMarketplace) {
      if (extension.isInstalled) {
        try {
          if (extension.category === "ui") {
            await uiExtensionHost.unloadExtension(extension.id);
          }
          await uninstallExtension(extension.id);
          showToast({
            message: `${extension.name} uninstalled successfully`,
            type: "success",
            duration: 3000,
          });
        } catch (error) {
          console.error(`Failed to uninstall ${extension.name}:`, error);
          showToast({
            message: `Failed to uninstall ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            type: "error",
            duration: 5000,
          });
        }
      } else {
        try {
          await installExtension(extension.id);
          if (extension.category === "ui") {
            const ext = availableExtensions.get(extension.id);
            if (ext) {
              await uiExtensionHost.loadExtension(ext.manifest, "");
            }
          }
          showToast({
            message: `${extension.name} installed successfully`,
            type: "success",
            duration: 3000,
          });
        } catch (error) {
          console.error(`Failed to install ${extension.name}:`, error);
          showToast({
            message: `Failed to install ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            type: "error",
            duration: 5000,
          });
        }
      }
      return;
    }

    if (extension.category === "ui") {
      const uiExtensionStore = useUIExtensionStore.getState();
      const sidebarViewForExtension = Array.from(uiExtensionStore.sidebarViews.values()).find(
        (view) => view.extensionId === extension.id,
      );

      uiExtensionStore.cleanupExtension(extension.id);

      if (sidebarViewForExtension && activeSidebarView === sidebarViewForExtension.id) {
        setActiveView("files");
      }

      showToast({
        message: `${extension.name} uninstalled successfully`,
        type: "success",
        duration: 3000,
      });
      return;
    }

    if (extension.category === "language") {
      const langExt = extensionManager
        .getAllLanguageExtensions()
        .find((e) => e.id === extension.id);
      if (langExt?.updateSettings) {
        const currentSettings = langExt.getSettings?.() || {};
        langExt.updateSettings({
          ...currentSettings,
          enabled: !extension.isInstalled,
        });
      }
    } else if (extension.category === "theme") {
      updateSetting("theme", extension.isInstalled ? "one-dark" : extension.id);
    } else if (extension.category === "icon-theme") {
      updateSetting("iconTheme", extension.isInstalled ? "material" : extension.id);
    }

    setTimeout(() => loadAllExtensions(), 100);
  };

  const filteredExtensions = extensions.filter((extension) => {
    const matchesSearch =
      extension.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      extension.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab =
      settings.extensionsActiveTab === "all" || extension.category === settings.extensionsActiveTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <p className="ui-font ui-text-md font-medium text-text">Extensions</p>
        <p className="mt-1 ui-font ui-text-sm text-text-lighter">
          Install built-in tools, manage marketplace extensions, skills, and generated custom tools.
        </p>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <Input
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          size="sm"
          containerClassName="flex-1"
        />
      </div>

      <div className="mb-3 overflow-x-auto">
        <SegmentedControl
          value={settings.extensionsActiveTab}
          onChange={(value) =>
            updateSetting("extensionsActiveTab", value as typeof settings.extensionsActiveTab)
          }
          className="inline-flex h-auto min-w-max max-w-full flex-wrap items-stretch gap-1 overflow-visible self-start rounded-xl border border-border/60 bg-secondary-bg/40 p-1"
          options={FILTER_TABS.map((tab) => {
            const Icon = "icon" in tab ? tab.icon : undefined;
            return {
              value: tab.id,
              label: tab.label,
              icon: Icon ? <Icon size={14} weight="duotone" /> : undefined,
            };
          })}
        />
      </div>

      {(settings.extensionsActiveTab === "ui" || settings.extensionsActiveTab === "all") && (
        <div className="mb-3">
          <ProActionButton
            onProClick={() => setShowCreateWizard(true)}
            variant="secondary"
            size="xs"
          >
            <Plus />
            Generate Custom Extension
          </ProActionButton>
        </div>
      )}

      {(settings.extensionsActiveTab === "skill" || settings.extensionsActiveTab === "all") && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => setIsSkillsCommandOpen(true)}
          >
            <Plus />
            New Skill
          </Button>
          {isLoadingSkills ? (
            <div className="ui-text-sm flex items-center gap-1.5 text-text-lighter">
              <RefreshCw className="animate-spin" />
              Loading skills
            </div>
          ) : null}
        </div>
      )}

      <div className="flex-1 overflow-auto pr-1.5">
        {filteredExtensions.length === 0 ? (
          <div className="py-8 text-center text-text-lighter">
            <Package className="mx-auto mb-1.5 opacity-50" />
            <p className="ui-font ui-text-sm">No extensions found matching your search.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredExtensions.map((extension) => {
              const extensionFromStore = availableExtensions.get(extension.id);
              const isInstalling = extensionFromStore?.isInstalling || false;
              const hasSkillUpdate = Boolean(
                extension.skill &&
                extension.marketplaceSkill &&
                hasMarketplaceSkillUpdate(extension.skill, extension.marketplaceSkill),
              );
              const hasUpdate = extensionsWithUpdates.has(extension.id) || hasSkillUpdate;
              const hasLocalOverride = extension.skill
                ? hasSkillLocalOverride(extension.skill)
                : false;
              const hasRuntimeIssue = Boolean(extension.runtimeIssues?.length);

              return (
                <ExtensionRow
                  key={extension.id}
                  extension={extension}
                  onToggle={() => handleToggle(extension)}
                  onResetOverride={() => handleResetSkillOverride(extension)}
                  onUpdate={() => handleUpdate(extension)}
                  isInstalling={isInstalling}
                  hasUpdate={hasUpdate}
                  hasLocalOverride={hasLocalOverride}
                  hasRuntimeIssue={hasRuntimeIssue}
                />
              );
            })}
          </div>
        )}
      </div>

      {showCreateWizard && (
        <Dialog
          title="Create UI Extension"
          onClose={() => setShowCreateWizard(false)}
          icon={Blocks}
          size="lg"
          classNames={{ content: "p-5" }}
        >
          <CreateExtensionWizard onClose={() => setShowCreateWizard(false)} />
        </Dialog>
      )}
      <SkillsCommand
        isOpen={isSkillsCommandOpen}
        initialView="editor"
        onClose={() => setIsSkillsCommandOpen(false)}
        onSelectSkill={() => setIsSkillsCommandOpen(false)}
      />
    </div>
  );
};
