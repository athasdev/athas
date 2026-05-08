import {
  Brain,
  Database,
  Package,
  PaintBrush,
  Plus,
  ArrowClockwise as RefreshCw,
  Robot,
  MagnifyingGlass as Search,
  TextT,
  WarningCircle,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import type { ExtensionRuntimeIssue } from "@/extensions/registry/extension-store-types";
import { themeRegistry } from "@/extensions/themes/theme-registry";
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
import type { AgentConfig } from "@/features/ai/types/acp";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { SegmentedControl } from "@/ui/segmented-control";
import { PLATFORM_ARCH } from "@/utils/platform";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database" | "skill" | "agent";
  isInstalled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
  isBundled?: boolean;
  runtimeIssues?: ExtensionRuntimeIssue[];
  skill?: AIChatSkill;
  marketplaceSkill?: MarketplaceSkill;
  agentId?: string;
  canInstall?: boolean;
  packageSize?: number;
  contributionSummary?: string[];
}

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "language", label: "Languages", icon: TextT },
  { id: "theme", label: "Themes", icon: PaintBrush },
  { id: "icon-theme", label: "Icon Themes", icon: Package },
  { id: "database", label: "Databases", icon: Database },
  { id: "skill", label: "Skills", icon: Brain },
  { id: "agent", label: "Agents", icon: Robot },
] as const;

type ExtensionTabId = (typeof FILTER_TABS)[number]["id"];
const FILTER_TAB_IDS = new Set<string>(FILTER_TABS.map((tab) => tab.id));

function isBuiltInDatabaseProvider(providerId: string): boolean {
  return providerId === "sqlite";
}

function formatBytes(size?: number): string {
  if (!size || size <= 0) return "Size unknown";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function resolvePackageSize(manifest: {
  installation?: {
    size?: number;
    platformArch?: Record<string, { size?: number }>;
  };
}): number | undefined {
  const platformSize = manifest.installation?.platformArch?.[PLATFORM_ARCH]?.size;
  if (typeof platformSize === "number" && platformSize > 0) return platformSize;
  const size = manifest.installation?.size;
  return typeof size === "number" && size > 0 ? size : undefined;
}

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
    case "agent":
      return "Agent";
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
  const isUnavailableAgent =
    extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
  const extensionLabels =
    extension.category === "agent"
      ? extension.extensions
      : extension.extensions?.map((ext) => `.${ext}`);

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
          {extension.publisher && extensionLabels && extensionLabels.length > 0 && <span>·</span>}
          {extensionLabels && extensionLabels.length > 0 && (
            <span>
              {extensionLabels.slice(0, 5).join(" ")}
              {extensionLabels.length > 5 && ` +${extensionLabels.length - 5}`}
            </span>
          )}
          {extension.packageSize ? (
            <>
              <span>·</span>
              <span>{formatBytes(extension.packageSize)}</span>
            </>
          ) : null}
        </div>
      </div>
      {extension.isBundled ? (
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="accent" size="compact" className="rounded-full">
            Built-in
          </Badge>
        </div>
      ) : isInstalling ? (
        <span className="ui-font ui-text-sm shrink-0 text-accent">Installing</span>
      ) : isUnavailableAgent ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button disabled variant="secondary" size="xs" tooltip="Unavailable">
            Unavailable
          </Button>
        </div>
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
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={onToggle} variant="default" size="xs" tooltip={installLabel}>
            {installLabel}
          </Button>
        </div>
      )}
    </div>
  );
};

export const ExtensionsSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [installingAgentIds, setInstallingAgentIds] = useState<Set<string>>(new Set());
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const { showToast } = useToast();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const { installExtension, uninstallExtension, updateExtension } = useExtensionStore.use.actions();

  useEffect(() => {
    if (!FILTER_TAB_IDS.has(settings.extensionsActiveTab)) {
      void updateSetting("extensionsActiveTab", "all");
    }
  }, [settings.extensionsActiveTab, updateSetting]);

  const loadAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
      setAgents(availableAgents);
    } catch (error) {
      console.error("Failed to load ACP agents:", error);
      setAgents([]);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  const loadAllExtensions = useCallback(() => {
    const allExtensions: UnifiedExtension[] = [];
    const detectedAgents = new Map(agents.map((agent) => [agent.id, agent]));

    for (const [, ext] of availableExtensions) {
      if (ext.manifest.agents && ext.manifest.agents.length > 0) {
        const contribution = ext.manifest.agents[0];
        const agent = detectedAgents.get(contribution.id);
        allExtensions.push({
          id: `agent:${contribution.id}`,
          name: agent?.name ?? contribution.name,
          description:
            agent?.description ?? contribution.description ?? "ACP-compatible coding agent",
          category: "agent",
          isInstalled: agent?.installed ?? false,
          version: ext.manifest.version,
          extensions: [agent?.binaryName ?? contribution.binaryName],
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          agentId: contribution.id,
          canInstall: agent?.canInstall ?? Boolean(contribution.install),
          contributionSummary: [
            `agent:${contribution.id}`,
            agent?.binaryName ?? contribution.binaryName,
          ].filter(Boolean),
        });
      }

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
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: [
            ...ext.manifest.languages.map((language) => `language:${language.id}`),
            ...(ext.manifest.lsp?.name ? [`lsp:${ext.manifest.lsp.name}`] : []),
            ...(ext.manifest.formatter?.name ? [`formatter:${ext.manifest.formatter.name}`] : []),
            ...(ext.manifest.linter?.name ? [`linter:${ext.manifest.linter.name}`] : []),
          ],
        });
      }

      if (ext.manifest.databaseProviders && ext.manifest.databaseProviders.length > 0) {
        const provider = ext.manifest.databaseProviders[0];
        const isBuiltInDatabase = isBuiltInDatabaseProvider(provider.id);
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "database",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          extensions: provider.fileExtensions?.map((item) => item.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: !isBuiltInDatabase,
          isBundled: isBuiltInDatabase,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: [`database:${provider.id}`],
        });
      }

      if (ext.manifest.themes && ext.manifest.themes.length > 0) {
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "theme",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: ext.manifest.themes.map((theme) => `theme:${theme.id}`),
        });
      }

      if (ext.manifest.iconThemes && ext.manifest.iconThemes.length > 0) {
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "icon-theme",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: ext.manifest.iconThemes.map((theme) => `icon-theme:${theme.id}`),
        });
      }
    }

    themeRegistry.getAllThemes().forEach((theme) => {
      if (themeRegistry.getThemeSource(theme.id)) {
        return;
      }

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
      if (iconThemeRegistry.getThemeSource(iconTheme.id)) {
        return;
      }

      allExtensions.push({
        id: iconTheme.id,
        name: iconTheme.name,
        description: iconTheme.description || `${iconTheme.name} icon theme`,
        category: "icon-theme",
        isInstalled: true,
        version: "1.0.0",
      });
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
        contributionSummary: ["skill"],
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
        contributionSummary: ["skill"],
      });
    }

    const agentIds = new Set(
      allExtensions
        .filter((extension) => extension.category === "agent")
        .map((extension) => extension.agentId ?? extension.id.replace(/^agent:/, "")),
    );
    for (const agent of agents) {
      if (agentIds.has(agent.id)) {
        continue;
      }

      allExtensions.push({
        id: `agent:${agent.id}`,
        name: agent.name,
        description: agent.description ?? "ACP-compatible coding agent",
        category: "agent",
        isInstalled: agent.installed,
        extensions: [agent.binaryName],
        publisher: "Marketplace",
        isMarketplace: true,
        agentId: agent.id,
        canInstall: agent.canInstall,
        contributionSummary: [`agent:${agent.id}`, agent.binaryName],
      });
    }

    setExtensions(allExtensions);
  }, [agents, availableExtensions, marketplaceSkills, settings.aiSkills]);

  useEffect(() => {
    loadAllExtensions();
  }, [loadAllExtensions]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

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
    if (extension.category === "agent") {
      if (!extension.isInstalled && extension.canInstall === false) {
        showToast({
          message: `${extension.name} cannot be installed automatically`,
          type: "error",
          duration: 5000,
        });
        return;
      }

      const agentId = extension.agentId ?? extension.id.replace(/^agent:/, "");
      setInstallingAgentIds((current) => new Set(current).add(agentId));

      try {
        const installedAgent = await invoke<AgentConfig>(
          extension.isInstalled ? "uninstall_acp_agent" : "install_acp_agent",
          { agentId },
        );
        setAgents((current) => {
          const next = new Map(current.map((agent) => [agent.id, agent]));
          next.set(installedAgent.id, installedAgent);
          return Array.from(next.values());
        });
        void loadAgents();
        const managedUninstallLeftGlobalBinary = extension.isInstalled && installedAgent.installed;
        showToast({
          message: extension.isInstalled
            ? managedUninstallLeftGlobalBinary
              ? `${extension.name} managed install removed`
              : `${extension.name} uninstalled successfully`
            : `${extension.name} installed successfully`,
          description: managedUninstallLeftGlobalBinary
            ? "A global installation is still detected on your PATH."
            : undefined,
          type: managedUninstallLeftGlobalBinary ? "info" : "success",
          duration: managedUninstallLeftGlobalBinary ? 5000 : 3000,
        });
      } catch (error) {
        console.error(
          `Failed to ${extension.isInstalled ? "uninstall" : "install"} ${extension.name}:`,
          error,
        );
        showToast({
          message: `Failed to ${extension.isInstalled ? "uninstall" : "install"} ${extension.name}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          type: "error",
          duration: 5000,
        });
      } finally {
        setInstallingAgentIds((current) => {
          const next = new Set(current);
          next.delete(agentId);
          return next;
        });
      }
      return;
    }

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

  const isExtensionInstalling = (extension: UnifiedExtension) =>
    Boolean(
      availableExtensions.get(extension.id)?.isInstalling ||
      (extension.category === "agent" &&
        installingAgentIds.has(extension.agentId ?? extension.id.replace(/^agent:/, ""))),
    );

  const hasExtensionUpdate = (extension: UnifiedExtension) =>
    extensionsWithUpdates.has(extension.id) ||
    Boolean(
      extension.skill &&
      extension.marketplaceSkill &&
      hasMarketplaceSkillUpdate(extension.skill, extension.marketplaceSkill),
    );

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <p className="ui-font ui-text-md font-medium text-text">Extensions</p>
        <p className="mt-1 ui-font ui-text-sm text-text-lighter">
          Install built-in tools, manage marketplace extensions, skills, and agents.
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
          onChange={(value) => updateSetting("extensionsActiveTab", value as ExtensionTabId)}
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

      {(settings.extensionsActiveTab === "agent" || settings.extensionsActiveTab === "all") &&
      isLoadingAgents ? (
        <div className="ui-text-sm mb-3 flex items-center gap-1.5 text-text-lighter">
          <RefreshCw className="animate-spin" />
          Loading agents
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="min-h-0 flex-1 overflow-auto pr-1.5">
          {filteredExtensions.length === 0 ? (
            <div className="py-8 text-center text-text-lighter">
              <Package className="mx-auto mb-1.5 opacity-50" />
              <p className="ui-font ui-text-sm">No extensions found matching your search.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredExtensions.map((extension) => {
                const isInstalling = isExtensionInstalling(extension);
                const hasUpdate = hasExtensionUpdate(extension);
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
      </div>

      <SkillsCommand
        isOpen={isSkillsCommandOpen}
        initialView="editor"
        onClose={() => setIsSkillsCommandOpen(false)}
        onSelectSkill={() => setIsSkillsCommandOpen(false)}
      />
    </div>
  );
};
