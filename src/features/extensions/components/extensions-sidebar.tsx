import {
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as Reset,
  BrainIcon as Brain,
  CheckIcon as Check,
  DatabaseIcon as Database,
  DotsThreeIcon as MoreHorizontal,
  DownloadSimpleIcon as Download,
  PackageIcon as Package,
  PaintBrushIcon as PaintBrush,
  PlusIcon as Plus,
  RobotIcon as Robot,
  MagnifyingGlassIcon as Search,
  SparkleIcon as Sparkles,
  TextTIcon as TextT,
  TrashIcon as Trash,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { getVisibleIconThemes } from "@/extensions/icon-themes/icon-theme-normalization";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import type { ExtensionRuntimeIssue } from "@/extensions/registry/extension-store-types";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import {
  getManifestAIProviderContributions,
  getManifestDatabaseContributions,
  getManifestIconContributions,
} from "@/extensions/types/extension-contributions";
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
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { LoadingIndicator } from "@/ui/loading";
import { SidebarEmptyState } from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { PLATFORM_ARCH } from "@/utils/platform";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database" | "ai" | "skill" | "agent";
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
  selectionId?: string;
  isActive?: boolean;
}

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "language", label: "Languages", icon: TextT },
  { id: "theme", label: "Themes", icon: PaintBrush },
  { id: "icon-theme", label: "Icon Themes", icon: Package },
  { id: "database", label: "Databases", icon: Database },
  { id: "ai", label: "AI", icon: Sparkles },
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

function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  return String(error || fallback);
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
    case "ai":
      return "AI";
    case "skill":
      return "Skill";
    case "agent":
      return "Agent";
    default:
      return category;
  }
};

function getPrimaryActionLabel(extension: UnifiedExtension): string {
  if (isAppearanceExtension(extension)) {
    if (extension.isInstalled) {
      return extension.isActive ? "Active" : "Use";
    }

    return "Install";
  }

  if (extension.category === "skill") {
    return extension.isInstalled ? "Remove" : "Add";
  }

  return extension.isInstalled ? "Uninstall" : "Install";
}

function isAppearanceExtension(extension: UnifiedExtension): boolean {
  return extension.category === "theme" || extension.category === "icon-theme";
}

function getAppearanceDefaultSelectionId(extension: UnifiedExtension): string | null {
  if (extension.category === "theme") return getDefaultSetting("theme");
  if (extension.category === "icon-theme") return getDefaultSetting("iconTheme");
  return null;
}

function canDeactivateAppearanceExtension(extension: UnifiedExtension): boolean {
  const defaultSelectionId = getAppearanceDefaultSelectionId(extension);
  return Boolean(
    isAppearanceExtension(extension) &&
    extension.isActive &&
    extension.selectionId &&
    defaultSelectionId &&
    extension.selectionId !== defaultSelectionId,
  );
}

function getCategoryIcon(category: UnifiedExtension["category"]): ReactNode {
  const className = "size-4 text-text-lighter";

  switch (category) {
    case "language":
      return <TextT className={className} weight="duotone" />;
    case "theme":
      return <PaintBrush className={className} weight="duotone" />;
    case "icon-theme":
      return <Package className={className} weight="duotone" />;
    case "database":
      return <Database className={className} weight="duotone" />;
    case "ai":
      return <Sparkles className={className} weight="duotone" />;
    case "skill":
      return <Brain className={className} weight="duotone" />;
    case "agent":
      return <Robot className={className} weight="duotone" />;
  }
}

const ExtensionRow = ({
  extension,
  onToggle,
  onResetOverride,
  onUpdate,
  onContextMenu,
  onOpenMenu,
  onSelect,
  selected,
  isInstalling,
  hasUpdate,
  hasLocalOverride,
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  onResetOverride?: () => void;
  onUpdate?: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, extension: UnifiedExtension) => void;
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>, extension: UnifiedExtension) => void;
  onSelect: () => void;
  selected?: boolean;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasLocalOverride?: boolean;
  hasRuntimeIssue?: boolean;
}) => {
  const primaryActionLabel = getPrimaryActionLabel(extension);
  const isUnavailableAgent =
    extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
  const isAppearance = isAppearanceExtension(extension);
  const extensionLabels =
    extension.category === "agent"
      ? extension.extensions
      : extension.extensions?.map((ext) => `.${ext}`);
  const actionContent = extension.isBundled ? (
    <span className="rounded-full border border-border/70 bg-secondary-bg/70 px-2 py-1 font-medium text-text-lighter ui-text-sm">
      Built-in
    </span>
  ) : isInstalling ? (
    <span className="flex h-8 w-8 items-center justify-center text-accent">
      <LoadingIndicator label="Installing" compact />
    </span>
  ) : isUnavailableAgent ? (
    <Button disabled variant="ghost" tooltip="Unavailable" compact className="h-8 w-8 min-w-0 p-0">
      <XCircle className="size-4" weight="duotone" />
    </Button>
  ) : isAppearance && extension.isInstalled ? (
    extension.isActive ? (
      <span className="inline-flex h-8 items-center gap-1 rounded-md border border-accent/25 bg-accent/10 px-2 font-medium text-accent ui-text-sm">
        <Check className="size-3.5" weight="bold" />
        Active
      </span>
    ) : (
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        variant="accent"
        tooltip={primaryActionLabel}
        compact
        className="h-8 px-2.5"
      >
        <Check className="size-4" weight="bold" />
        Use
      </Button>
    )
  ) : extension.isInstalled ? (
    <div className="flex shrink-0 items-center gap-1">
      {(hasUpdate || hasRuntimeIssue) && onUpdate && (
        <Button
          onClick={(event) => {
            event.stopPropagation();
            onUpdate();
          }}
          variant="default"
          tooltip={hasRuntimeIssue ? "Reinstall" : "Update"}
          compact
          className="h-8 w-8 min-w-0 p-0"
        >
          <RefreshCw className="size-4" weight="duotone" />
        </Button>
      )}
      {hasLocalOverride && onResetOverride && (
        <Button
          onClick={(event) => {
            event.stopPropagation();
            onResetOverride();
          }}
          variant="default"
          tooltip="Reset to marketplace version"
          compact
          className="h-8 w-8 min-w-0 p-0"
        >
          <Reset className="size-4" weight="duotone" />
        </Button>
      )}
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        variant="ghost"
        tooltip={primaryActionLabel}
        compact
        className="h-8 w-8 min-w-0 p-0 text-text-lighter hover:text-error"
      >
        <Trash className="size-4" weight="duotone" />
      </Button>
    </div>
  ) : (
    <Button
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      variant="accent"
      tooltip={primaryActionLabel}
      compact
      className="h-8 px-2.5"
    >
      <Download className="size-4" weight="fill" />
      {primaryActionLabel}
    </Button>
  );

  return (
    <div
      className={cn(
        "group flex min-w-0 flex-col rounded-md border bg-primary-bg text-text-lighter transition-colors",
        "hover:border-border/90 hover:bg-secondary-bg/35 hover:text-text",
        selected ? "border-accent/50 ring-1 ring-accent/20" : "border-border/65",
      )}
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, extension)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex min-w-0 items-start gap-3 p-3 pb-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-secondary-bg/55">
          {getCategoryIcon(extension.category)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate font-medium text-text">{extension.name}</span>
            {extension.version ? (
              <span className="shrink-0 ui-font ui-text-sm text-text-lighter">
                v{extension.version}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 min-w-0 truncate text-text-lighter ui-text-sm">
            {extension.publisher
              ? `By ${extension.publisher}`
              : getCategoryLabel(extension.category)}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actionContent}
          <Button
            type="button"
            variant="ghost"
            compact
            tooltip="More actions"
            aria-label={`More actions for ${extension.name}`}
            className="h-8 w-8 min-w-0 p-0 text-text-lighter opacity-75 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenu(event, extension);
            }}
          >
            <MoreHorizontal className="size-4" weight="bold" />
          </Button>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2 px-3 pb-3">
        {extension.description ? (
          <p className="line-clamp-2 min-h-[2.5rem] text-text-lighter ui-text-sm">
            {extension.description}
          </p>
        ) : null}
        {extension.runtimeIssues && extension.runtimeIssues.length > 0 ? (
          <div className="rounded-md border border-error/20 bg-error/8 px-2 py-1">
            <div className="ui-font ui-text-sm flex items-start gap-1.5 text-error">
              <WarningCircle className="mt-0.5 shrink-0" size={13} weight="duotone" />
              <span className="min-w-0 truncate">{extension.runtimeIssues[0].message}</span>
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="default" size="compact">
            {getCategoryLabel(extension.category)}
          </Badge>
          {extension.isInstalled ? (
            <Badge variant="accent" size="compact">
              Installed
            </Badge>
          ) : null}
          {hasUpdate ? (
            <Badge variant="accent" size="compact">
              Update
            </Badge>
          ) : null}
          {extension.isActive ? (
            <Badge variant="accent" size="compact">
              Active
            </Badge>
          ) : null}
          {hasLocalOverride ? (
            <Badge
              variant="default"
              size="compact"
              className="border-warning/25 bg-warning/10 text-warning"
            >
              Local override
            </Badge>
          ) : null}
        </div>
        <div className="ui-font ui-text-sm flex min-w-0 flex-wrap items-center gap-1.5 text-text-lighter">
          {extensionLabels && extensionLabels.length > 0 ? (
            <span className="truncate">
              {extensionLabels.slice(0, 5).join(" ")}
              {extensionLabels.length > 5 && ` +${extensionLabels.length - 5}`}
            </span>
          ) : null}
          {extension.packageSize ? (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatBytes(extension.packageSize)}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const ExtensionsSidebar = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiSkills: state.settings.aiSkills,
      extensionsActiveTab: state.settings.extensionsActiveTab,
      iconTheme: state.settings.iconTheme,
      theme: state.settings.theme,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [installingAgentIds, setInstallingAgentIds] = useState<Set<string>>(new Set());
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const { showToast } = useToast();
  const extensionContextMenu = useContextMenu<UnifiedExtension>();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const { installExtension, uninstallExtension, updateExtension } = useExtensionStore.use.actions();

  useEffect(() => {
    if (!FILTER_TAB_IDS.has(settings.extensionsActiveTab)) {
      void updateSetting("extensionsActiveTab", "all");
    }
  }, [settings.extensionsActiveTab, updateSetting]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

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

      const databaseContributions = getManifestDatabaseContributions(ext.manifest);
      if (databaseContributions.length > 0) {
        const provider = databaseContributions[0];
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
        const themeIds = ext.manifest.themes.map((theme) => theme.id);
        const activeThemeId = themeIds.find((themeId) => themeId === settings.theme);
        const themeId = activeThemeId ?? themeIds[0] ?? ext.manifest.id;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "theme",
          isInstalled: ext.isInstalled,
          isActive: Boolean(activeThemeId),
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          selectionId: themeId,
          contributionSummary: ext.manifest.themes.map((theme) => `theme:${theme.id}`),
        });
      }

      const iconContributions = getManifestIconContributions(ext.manifest);
      if (iconContributions.length > 0) {
        const iconThemeIds = iconContributions.map((theme) => theme.id);
        const activeIconThemeId = iconThemeIds.find((themeId) => themeId === settings.iconTheme);
        const iconThemeId = activeIconThemeId ?? iconThemeIds[0] ?? ext.manifest.id;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "icon-theme",
          isInstalled: ext.isInstalled,
          isActive: Boolean(activeIconThemeId),
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          selectionId: iconThemeId,
          contributionSummary: iconContributions.map((theme) => `icon:${theme.id}`),
        });
      }

      const aiProviderContributions = getManifestAIProviderContributions(ext.manifest);
      if (aiProviderContributions.length > 0) {
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "ai",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: aiProviderContributions.map((provider) => `provider:${provider.id}`),
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
        isActive: settings.theme === theme.id,
        version: "1.0.0",
        selectionId: theme.id,
      });
    });

    getVisibleIconThemes(iconThemeRegistry.getAllThemes()).forEach((iconTheme) => {
      if (iconThemeRegistry.getThemeSource(iconTheme.id)) {
        return;
      }

      allExtensions.push({
        id: iconTheme.id,
        name: iconTheme.name,
        description: iconTheme.description || `${iconTheme.name} icon theme`,
        category: "icon-theme",
        isInstalled: true,
        isActive: settings.iconTheme === iconTheme.id,
        version: "1.0.0",
        selectionId: iconTheme.id,
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
  }, [
    agents,
    availableExtensions,
    marketplaceSkills,
    settings.aiSkills,
    settings.iconTheme,
    settings.theme,
  ]);

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
          message: `Failed to update ${extension.name}: ${getErrorMessage(error)}`,
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
        message: `Failed to update ${extension.name}: ${getErrorMessage(error)}`,
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
        message: `Failed to reset ${extension.name}: ${getErrorMessage(error)}`,
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
          message: `Failed to ${extension.isInstalled ? "uninstall" : "install"} ${extension.name}: ${getErrorMessage(
            error,
          )}`,
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
          message: `Failed to update ${extension.name}: ${getErrorMessage(error)}`,
          type: "error",
          duration: 5000,
        });
      }
      return;
    }

    if (isAppearanceExtension(extension) && extension.isInstalled) {
      if (extension.isActive) {
        return;
      }

      const selectionId = extension.selectionId ?? extension.id;
      try {
        if (extension.category === "theme") {
          await updateSetting("theme", selectionId);
        } else {
          await updateSetting("iconTheme", selectionId);
        }
        showToast({
          message: `${extension.name} activated`,
          type: "success",
          duration: 2500,
        });
      } catch (error) {
        console.error(`Failed to activate ${extension.name}:`, error);
        showToast({
          message: `Failed to activate ${extension.name}: ${getErrorMessage(error)}`,
          type: "error",
          duration: 5000,
        });
      }
      setTimeout(() => loadAllExtensions(), 100);
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
            message: `Failed to uninstall ${extension.name}: ${getErrorMessage(error)}`,
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
            message: `Failed to install ${extension.name}: ${getErrorMessage(error)}`,
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
    }

    setTimeout(() => loadAllExtensions(), 100);
  };

  const handleDeactivateAppearance = async (extension: UnifiedExtension) => {
    const defaultSelectionId = getAppearanceDefaultSelectionId(extension);
    if (!defaultSelectionId || !canDeactivateAppearanceExtension(extension)) {
      return;
    }

    try {
      if (extension.category === "theme") {
        await updateSetting("theme", defaultSelectionId);
      } else {
        await updateSetting("iconTheme", defaultSelectionId);
      }
      showToast({
        message: `${extension.name} deactivated`,
        type: "success",
        duration: 2500,
      });
    } catch (error) {
      console.error(`Failed to deactivate ${extension.name}:`, error);
      showToast({
        message: `Failed to deactivate ${extension.name}: ${getErrorMessage(error)}`,
        type: "error",
        duration: 5000,
      });
    }

    setTimeout(() => loadAllExtensions(), 100);
  };

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
  const filterCounts = FILTER_TABS.reduce(
    (counts, tab) => {
      counts[tab.id] =
        tab.id === "all"
          ? searchMatchedExtensions.length
          : searchMatchedExtensions.filter((extension) => extension.category === tab.id).length;
      return counts;
    },
    {} as Record<ExtensionTabId, number>,
  );
  const filteredExtensions = searchMatchedExtensions.filter((extension) => {
    const matchesTab =
      settings.extensionsActiveTab === "all" || extension.category === settings.extensionsActiveTab;
    return matchesTab;
  });
  const selectedExtension =
    filteredExtensions.find((extension) => extension.id === selectedExtensionId) ??
    filteredExtensions[0] ??
    null;
  const installedCount = extensions.filter((extension) => extension.isInstalled).length;

  useEffect(() => {
    if (filteredExtensions.length === 0) {
      if (selectedExtensionId !== null) setSelectedExtensionId(null);
      return;
    }

    if (
      !selectedExtensionId ||
      !filteredExtensions.some((item) => item.id === selectedExtensionId)
    ) {
      setSelectedExtensionId(filteredExtensions[0]?.id ?? null);
    }
  }, [filteredExtensions, selectedExtensionId]);

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
  const updateCount = extensions.filter((extension) => hasExtensionUpdate(extension)).length;

  const handleExtensionContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>, extension: UnifiedExtension) => {
      extensionContextMenu.open(event, extension);
    },
    [extensionContextMenu],
  );

  const handleOpenExtensionMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, extension: UnifiedExtension) => {
      extensionContextMenu.open(event, extension);
    },
    [extensionContextMenu],
  );

  const extensionContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const extension = extensionContextMenu.data;
    if (!extension) return [];

    const items: ContextMenuItem[] = [];
    const isInstalling = isExtensionInstalling(extension);
    const hasUpdate = hasExtensionUpdate(extension);
    const hasLocalOverride = extension.skill ? hasSkillLocalOverride(extension.skill) : false;
    const hasRuntimeIssue = Boolean(extension.runtimeIssues?.length);
    const isUnavailableAgent =
      extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
    const isAppearance = isAppearanceExtension(extension);
    const primaryActionLabel = getPrimaryActionLabel(extension);

    if (extension.isBundled) {
      items.push({
        id: "built-in",
        label: "Built-in",
        icon: <Check className="size-3.5 text-accent" />,
        disabled: true,
        onClick: () => {},
      });
      return items;
    }

    if (isAppearance && extension.isInstalled) {
      if (canDeactivateAppearanceExtension(extension)) {
        items.push({
          id: "deactivate",
          label: "Deactivate",
          icon: <XCircle className="size-3.5" weight="duotone" />,
          onClick: () => {
            void handleDeactivateAppearance(extension);
          },
        });
      } else {
        items.push({
          id: extension.isActive ? "active" : "use",
          label: extension.isActive ? "Active" : "Use",
          icon: <Check className="size-3.5 text-accent" weight="bold" />,
          disabled: extension.isActive,
          onClick: () => {
            void handleToggle(extension);
          },
        });
      }

      if (!extension.isMarketplace) {
        return items;
      }
    }

    if ((hasUpdate || hasRuntimeIssue) && extension.isInstalled) {
      items.push({
        id: "update",
        label: hasRuntimeIssue ? "Reinstall" : "Update",
        icon: <RefreshCw className="size-3.5" weight="duotone" />,
        disabled: isInstalling,
        onClick: () => {
          void handleUpdate(extension);
        },
      });
    }

    if (hasLocalOverride) {
      items.push({
        id: "reset",
        label: "Reset to Marketplace Version",
        icon: <Reset className="size-3.5" weight="duotone" />,
        disabled: isInstalling,
        onClick: () => {
          void handleResetSkillOverride(extension);
        },
      });
    }

    if (items.length > 0) {
      items.push({ id: "sep-primary-action", label: "", separator: true, onClick: () => {} });
    }

    items.push({
      id: "toggle",
      label: isAppearance && extension.isInstalled ? "Uninstall" : primaryActionLabel,
      icon: extension.isInstalled ? (
        <Trash className="size-3.5" weight="duotone" />
      ) : (
        <Download className="size-3.5" weight="fill" />
      ),
      disabled: isInstalling || isUnavailableAgent,
      className: extension.isInstalled ? "text-error hover:text-error" : undefined,
      onClick: () => {
        void handleToggle(extension);
      },
    });

    return items;
  }, [extensionContextMenu.data, extensionsWithUpdates, installingAgentIds, availableExtensions]);

  return (
    <div className="ui-font flex h-full min-h-0 flex-col bg-primary-bg [--app-ui-badge-font-size:var(--ui-text-base)] [--app-ui-button-font-size:var(--ui-text-base)]">
      <div className="shrink-0 border-border/70 border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Package className="size-5 text-text-lighter" weight="duotone" />
              <h1 className="font-semibold text-text ui-text-lg">Extensions</h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 ui-text-sm text-text-lighter">
              <span>{extensions.length} available</span>
              <span>·</span>
              <span>{installedCount} installed</span>
              {updateCount > 0 ? (
                <>
                  <span>·</span>
                  <span className="text-accent">
                    {updateCount} update{updateCount === 1 ? "" : "s"}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-[260px] flex-1 items-center justify-end gap-2 sm:flex-none">
            <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-text-lighter" />
              <input
                ref={searchInputRef}
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search extensions"
                className="ui-font h-9 w-full rounded-md border border-border bg-secondary-bg/45 pr-3 pl-8 text-text outline-none transition-colors placeholder:text-text-lighter focus:border-accent/60 focus:bg-secondary-bg"
              />
            </div>
            {settings.extensionsActiveTab === "skill" ? (
              <Button variant="default" compact onClick={() => setIsSkillsCommandOpen(true)}>
                <Plus />
                New Skill
              </Button>
            ) : null}
          </div>
        </div>

        <div className="custom-scrollbar-thin mt-4 flex gap-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const Icon = "icon" in tab ? tab.icon : undefined;
            const active = settings.extensionsActiveTab === tab.id;
            const count = filterCounts[tab.id] ?? 0;

            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "group flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 ui-text-sm transition-colors",
                  active
                    ? "bg-accent text-primary-bg"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
                onClick={() => void updateSetting("extensionsActiveTab", tab.id as ExtensionTabId)}
              >
                {Icon ? <Icon className="size-3.5" weight={active ? "fill" : "duotone"} /> : null}
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 leading-none ui-text-sm transition-colors",
                    active
                      ? "bg-primary-bg/20 text-primary-bg"
                      : "bg-hover/70 text-text-lighter group-hover:text-text",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(380px,1fr)_minmax(340px,440px)]">
        <div className="custom-scrollbar-thin min-h-0 overflow-y-auto border-border/70 border-r p-5">
          {settings.extensionsActiveTab === "skill" && isLoadingSkills ? (
            <div className="mb-3">
              <LoadingIndicator label="Loading skills" showLabel compact />
            </div>
          ) : null}

          {settings.extensionsActiveTab === "agent" && isLoadingAgents ? (
            <div className="mb-3">
              <LoadingIndicator label="Loading agents" showLabel compact />
            </div>
          ) : null}

          {filteredExtensions.length === 0 ? (
            <SidebarEmptyState>No extensions found.</SidebarEmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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
                    selected={selectedExtension?.id === extension.id}
                    onSelect={() => setSelectedExtensionId(extension.id)}
                    onToggle={() => handleToggle(extension)}
                    onResetOverride={() => handleResetSkillOverride(extension)}
                    onUpdate={() => handleUpdate(extension)}
                    onContextMenu={handleExtensionContextMenu}
                    onOpenMenu={handleOpenExtensionMenu}
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

        <aside className="custom-scrollbar-thin hidden min-h-0 overflow-y-auto bg-secondary-bg/25 p-5 lg:block">
          {selectedExtension ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border/70 bg-primary-bg">
                  {getCategoryIcon(selectedExtension.category)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold text-text ui-text-xl">
                    {selectedExtension.name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-text-lighter ui-text-sm">
                    {selectedExtension.publisher ? (
                      <span>By {selectedExtension.publisher}</span>
                    ) : null}
                    {selectedExtension.version ? <span>v{selectedExtension.version}</span> : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge variant="default" size="compact">
                  {getCategoryLabel(selectedExtension.category)}
                </Badge>
                {selectedExtension.isInstalled ? (
                  <Badge variant="accent" size="compact">
                    Installed
                  </Badge>
                ) : null}
                {hasExtensionUpdate(selectedExtension) ? (
                  <Badge variant="accent" size="compact">
                    Update
                  </Badge>
                ) : null}
                {selectedExtension.isActive ? (
                  <Badge variant="accent" size="compact">
                    Active
                  </Badge>
                ) : null}
                {selectedExtension.isBundled ? (
                  <Badge variant="accent" size="compact">
                    Built-in
                  </Badge>
                ) : null}
              </div>

              {selectedExtension.description ? (
                <p className="leading-6 text-text-lighter ui-text-base">
                  {selectedExtension.description}
                </p>
              ) : null}

              {selectedExtension.runtimeIssues?.length ? (
                <div className="rounded-md border border-error/25 bg-error/8 p-3 text-error ui-text-sm">
                  {selectedExtension.runtimeIssues[0]?.message}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {!selectedExtension.isBundled ? (
                  <Button
                    variant={
                      isAppearanceExtension(selectedExtension) && selectedExtension.isActive
                        ? "default"
                        : isAppearanceExtension(selectedExtension) && selectedExtension.isInstalled
                          ? "accent"
                          : selectedExtension.isInstalled
                            ? "ghost"
                            : "accent"
                    }
                    className={
                      selectedExtension.isInstalled && !isAppearanceExtension(selectedExtension)
                        ? "text-text-lighter hover:text-error"
                        : undefined
                    }
                    onClick={() => void handleToggle(selectedExtension)}
                    disabled={
                      (isAppearanceExtension(selectedExtension) && selectedExtension.isActive) ||
                      isExtensionInstalling(selectedExtension) ||
                      (selectedExtension.category === "agent" &&
                        !selectedExtension.isInstalled &&
                        selectedExtension.canInstall === false)
                    }
                  >
                    {isAppearanceExtension(selectedExtension) && selectedExtension.isInstalled ? (
                      <Check />
                    ) : selectedExtension.isInstalled ? (
                      <Trash />
                    ) : (
                      <Download weight="fill" />
                    )}
                    {getPrimaryActionLabel(selectedExtension)}
                  </Button>
                ) : null}
                {hasExtensionUpdate(selectedExtension) && selectedExtension.isInstalled ? (
                  <Button
                    variant="default"
                    onClick={() => void handleUpdate(selectedExtension)}
                    disabled={isExtensionInstalling(selectedExtension)}
                  >
                    <RefreshCw />
                    Update
                  </Button>
                ) : null}
                {canDeactivateAppearanceExtension(selectedExtension) ? (
                  <Button
                    variant="ghost"
                    className="text-text-lighter"
                    onClick={() => void handleDeactivateAppearance(selectedExtension)}
                  >
                    <XCircle />
                    Deactivate
                  </Button>
                ) : null}
                {selectedExtension.skill && hasSkillLocalOverride(selectedExtension.skill) ? (
                  <Button
                    variant="default"
                    onClick={() => void handleResetSkillOverride(selectedExtension)}
                  >
                    <Reset />
                    Reset
                  </Button>
                ) : null}
              </div>

              <div className="border-border/70 border-t pt-4">
                <div className="mb-2 font-medium text-text ui-text-sm">Contributions</div>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedExtension.contributionSummary?.length
                    ? selectedExtension.contributionSummary
                    : selectedExtension.extensions
                      ? selectedExtension.extensions
                      : [getCategoryLabel(selectedExtension.category)]
                  ).map((item) => (
                    <span
                      key={item}
                      className="rounded-md border border-border/60 bg-primary-bg px-2 py-1 text-text-lighter ui-text-sm"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <SidebarEmptyState>No extension selected.</SidebarEmptyState>
          )}
        </aside>
      </div>

      <SkillsCommand
        isOpen={isSkillsCommandOpen}
        initialView="editor"
        onClose={() => setIsSkillsCommandOpen(false)}
        onSelectSkill={() => setIsSkillsCommandOpen(false)}
      />

      <ContextMenu
        isOpen={extensionContextMenu.isOpen}
        position={extensionContextMenu.position}
        items={extensionContextMenuItems}
        onClose={extensionContextMenu.close}
      />
    </div>
  );
};
