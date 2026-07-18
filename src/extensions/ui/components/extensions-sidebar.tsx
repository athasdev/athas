import {
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as Reset,
  BrainIcon as Brain,
  CheckIcon as Check,
  DatabaseIcon as Database,
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
} from "@/ui/icons";
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
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import {
  getManifestAIProviderContributions,
  getManifestDatabaseContributions,
  getManifestIconContributions,
  getManifestThemeContributions,
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
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dropdown, useDropdownMenu, type MenuItem } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { SearchField } from "@/ui/search";
import { SidebarEmptyState } from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { PLATFORM_ARCH } from "@/utils/platform";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database" | "ai" | "skill" | "agent";
  isInstalled: boolean;
  isEnabled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
  isBundled?: boolean;
  runtimeIssues?: ExtensionRuntimeIssue[];
  skill?: AIChatSkill;
  marketplaceSkill?: MarketplaceSkill;
  agentId?: string;
  icon?: string | null;
  canInstall?: boolean;
  packageSize?: number;
  contributionSummary?: string[];
  selectionId?: string;
  appearanceOptions?: AppearanceOption[];
  isActive?: boolean;
}

interface AppearanceOption {
  id: string;
  name: string;
  description?: string;
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
const LOCAL_FILE_ICON_MODULES = import.meta.glob(
  "../../../extensions/bundled/icon-themes/athas/icons/files/*.svg",
  { eager: true, import: "default", query: "?url" },
) as Record<string, string>;
const LOCAL_FILE_ICON_URLS = new Map(
  Object.entries(LOCAL_FILE_ICON_MODULES).map(([path, url]) => [
    path
      .split("/")
      .pop()
      ?.replace(/\.svg$/i, "") ?? path,
    url,
  ]),
);

const SIMPLE_ICON_SLUGS: Record<string, string> = {
  alibaba: "alibabacloud",
  alibabacloud: "alibabacloud",
  anthropic: "anthropic",
  claude: "claude",
  "claude-code": "claude",
  duckdb: "duckdb",
  gemini: "googlegemini",
  "gemini-cli": "googlegemini",
  "google-gemini": "googlegemini",
  googlegemini: "googlegemini",
  mongodb: "mongodb",
  mongo: "mongodb",
  mysql: "mysql",
  opencode: "opencode",
  postgres: "postgresql",
  postgresql: "postgresql",
  qwen: "qwen",
  "qwen-code": "qwen",
  redis: "redis",
  sqlite: "sqlite",
  v0: "v0",
  vercel: "vercel",
};

const LOCAL_ICON_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  csharp: "csharp",
  duckdb: "database",
  icon: "package",
  "icon-theme": "package",
  javascriptreact: "react",
  js: "javascript",
  kimi: "agents",
  "kimi-cli": "agents",
  less: "css",
  md: "markdown",
  mongodb: "mongo",
  mysql: "database",
  openai: "codex",
  opencode: "agents",
  postgresql: "postgres",
  rs: "rust",
  scss: "sass",
  sh: "shell",
  sqlite: "database",
  ts: "typescript",
  tsx: "react",
  typescriptreact: "react",
};

const SIMPLE_ICON_COLOR = "8B8F99";

function isBuiltInDatabaseProvider(providerId: string): boolean {
  return providerId === "sqlite";
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
      if (!extension.isEnabled) return "Activate";
      return extension.isActive ? "Current" : "Use";
    }

    return "Install";
  }

  if (extension.category === "skill") {
    return extension.isInstalled ? "Remove" : "Add";
  }

  if (extension.category === "agent") {
    return extension.isInstalled ? "Uninstall" : "Install";
  }

  return extension.isInstalled ? (extension.isEnabled ? "Deactivate" : "Activate") : "Install";
}

function isAppearanceExtension(extension: UnifiedExtension): boolean {
  return extension.category === "theme" || extension.category === "icon-theme";
}

function getAppearanceSettingKey(extension: UnifiedExtension): "theme" | "iconTheme" | null {
  if (extension.category === "theme") return "theme";
  if (extension.category === "icon-theme") return "iconTheme";
  return null;
}

function getAppearanceOptionLabel(extension: UnifiedExtension, optionId: string): string {
  return (
    extension.appearanceOptions?.find((option) => option.id === optionId)?.name ?? extension.name
  );
}

function canDeactivateAppearanceExtension(extension: UnifiedExtension): boolean {
  return Boolean(
    isAppearanceExtension(extension) &&
    extension.isInstalled &&
    extension.isEnabled &&
    !extension.isBundled,
  );
}

function normalizeIconLookupKey(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripGenericIconLookupTerms(value: string): string {
  return normalizeIconLookupKey(
    value.replace(/\b(?:provider|language support|language|theme|icons?|cli|code)\b/g, " "),
  );
}

function getIconLookupCandidates(iconId: string | undefined | null): string[] {
  const normalized = normalizeIconLookupKey(iconId);
  if (!normalized) return [];

  const stripped = stripGenericIconLookupTerms(normalized.replace(/-/g, " "));
  const baseCandidates = [
    normalized,
    stripped,
    normalized.replace(/-/g, ""),
    stripped.replace(/-/g, ""),
  ].filter(Boolean);

  return Array.from(
    new Set(
      baseCandidates.flatMap((candidate) => [
        candidate,
        LOCAL_ICON_ALIASES[candidate],
        SIMPLE_ICON_SLUGS[candidate],
      ]),
    ),
  ).filter(Boolean) as string[];
}

function getLocalFileIconUrl(iconId: string | undefined | null): string | undefined {
  const candidates = getIconLookupCandidates(iconId);

  for (const candidate of candidates) {
    const url = LOCAL_FILE_ICON_URLS.get(candidate);
    if (url) return url;
  }

  return undefined;
}

function getSimpleIconUrl(iconId: string | undefined | null): string | undefined {
  const candidates = getIconLookupCandidates(iconId);
  const slug = candidates.find((candidate) => SIMPLE_ICON_SLUGS[candidate]);

  return slug
    ? `https://cdn.simpleicons.org/${SIMPLE_ICON_SLUGS[slug]}/${SIMPLE_ICON_COLOR}`
    : undefined;
}

function getCatalogIconUrl(...iconIds: Array<string | undefined | null>): string | undefined {
  for (const iconId of iconIds) {
    const simpleIcon = getSimpleIconUrl(iconId);
    if (simpleIcon) return simpleIcon;

    const localIcon = getLocalFileIconUrl(iconId);
    if (localIcon) return localIcon;
  }

  return undefined;
}

function resolveManifestIcon(
  manifestIcon: string | undefined,
  ...fallbackIconIds: Array<string | undefined | null>
): string | undefined {
  const trimmedIcon = manifestIcon?.trim();
  const resolvedFallback = getCatalogIconUrl(...fallbackIconIds);
  const iconFileName = trimmedIcon?.split(/[?#]/)[0]?.split("/").pop()?.toLowerCase();

  if (!trimmedIcon || iconFileName === "icon.svg") {
    return resolvedFallback ?? trimmedIcon;
  }

  return trimmedIcon;
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

function isImageIcon(icon: string): boolean {
  return (
    /^(?:[a-z]+:)?\/\//i.test(icon) ||
    icon.startsWith("/") ||
    icon.startsWith("data:") ||
    /\.(?:svg|png|jpe?g|webp)(?:[?#].*)?$/i.test(icon)
  );
}

function isNamedIcon(icon: string): boolean {
  return !icon.includes("/") && !/\.(?:svg|png|jpe?g|webp)(?:[?#].*)?$/i.test(icon);
}

function ExtensionIcon({ extension }: { extension: UnifiedExtension }) {
  const [failedImageIcon, setFailedImageIcon] = useState(false);
  const icon = extension.icon?.trim();
  const showImageIcon = Boolean(icon && isImageIcon(icon) && !failedImageIcon);
  const showNamedIcon = Boolean(icon && !isImageIcon(icon) && isNamedIcon(icon));

  useEffect(() => {
    setFailedImageIcon(false);
  }, [icon]);

  return (
    <span
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/60",
        showImageIcon ? "bg-white/95" : "bg-primary-bg",
      )}
    >
      {showImageIcon ? (
        <img
          alt=""
          className="size-7 object-contain"
          draggable={false}
          src={icon}
          onError={() => setFailedImageIcon(true)}
        />
      ) : showNamedIcon && icon ? (
        <DynamicIcon name={icon} className="size-5 text-text-lighter" />
      ) : (
        getCategoryIcon(extension.category)
      )}
    </span>
  );
}

const ExtensionRow = ({
  extension,
  onToggle,
  onUpdate,
  onContextMenu,
  onSelect,
  selected,
  isInstalling,
  hasUpdate,
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  onUpdate?: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, extension: UnifiedExtension) => void;
  onSelect: () => void;
  selected?: boolean;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasRuntimeIssue?: boolean;
}) => {
  const primaryActionLabel = getPrimaryActionLabel(extension);
  const isUnavailableAgent =
    extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
  const actionContent = isInstalling ? (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-accent">
      <Spinner label="Installing" compact />
    </span>
  ) : hasRuntimeIssue && onUpdate ? (
    <Button
      onClick={(event) => {
        event.stopPropagation();
        onUpdate();
      }}
      variant="default"
      tooltip="Reinstall"
      size="icon"
      className="text-error"
    >
      <WarningCircle className="size-4" weight="duotone" />
    </Button>
  ) : hasUpdate && onUpdate ? (
    <Button
      onClick={(event) => {
        event.stopPropagation();
        onUpdate();
      }}
      variant="default"
      tooltip="Update"
      size="icon"
    >
      <RefreshCw className="size-4" weight="duotone" />
    </Button>
  ) : isUnavailableAgent ? (
    <Button disabled variant="ghost" tooltip="Unavailable" size="icon">
      <XCircle className="size-4" weight="duotone" />
    </Button>
  ) : extension.isInstalled ? (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center text-text-lighter"
      aria-label={extension.isBundled ? "Built-in" : "Installed"}
    >
      <Check className="size-4" weight="bold" />
    </span>
  ) : (
    <Button
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      variant="default"
      tooltip={primaryActionLabel}
      size="icon"
    >
      <Plus className="size-4" weight="bold" />
    </Button>
  );

  return (
    <div
      className={cn(
        "group flex min-h-16 min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left text-text-lighter transition-colors",
        "hover:bg-hover/70 hover:text-text focus-within:bg-hover/70",
        selected && "bg-hover/80 text-text",
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
      <ExtensionIcon extension={extension} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text ui-text-sm">{extension.name}</div>
        {extension.description ? (
          <div className="mt-0.5 truncate text-text-lighter ui-text-sm">
            {extension.description}
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center justify-center">{actionContent}</div>
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
  const extensionContextMenu = useDropdownMenu<UnifiedExtension>();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const {
    installExtension,
    uninstallExtension,
    enableExtension,
    disableExtension,
    updateExtension,
  } = useExtensionStore.use.actions();

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
          isEnabled: agent?.installed ?? false,
          version: ext.manifest.version,
          extensions: [agent?.binaryName ?? contribution.binaryName],
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          runtimeIssues: ext.runtimeIssues,
          agentId: contribution.id,
          icon: resolveManifestIcon(
            agent?.icon ?? contribution.icon ?? ext.manifest.icon,
            contribution.id,
            agent?.id,
            agent?.name,
            contribution.name,
            contribution.binaryName,
            ext.manifest.displayName,
          ),
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
          isEnabled: ext.isEnabled,
          version: ext.manifest.version,
          extensions: lang.extensions.map((e: string) => e.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: !isBundled,
          isBundled,
          icon: resolveManifestIcon(
            ext.manifest.icon,
            lang.id,
            lang.aliases?.[0],
            lang.extensions[0],
            ext.manifest.displayName,
            ext.manifest.name,
          ),
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
          isEnabled: ext.isEnabled,
          version: ext.manifest.version,
          extensions: provider.fileExtensions?.map((item) => item.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: !isBuiltInDatabase,
          isBundled: isBuiltInDatabase,
          icon: resolveManifestIcon(
            ext.manifest.icon,
            provider.id,
            provider.label,
            ext.manifest.displayName,
          ),
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          contributionSummary: [`database:${provider.id}`],
        });
      }

      const themeContributions = getManifestThemeContributions(ext.manifest);
      if (themeContributions.length > 0) {
        const themeIds = themeContributions.map((theme) => theme.id);
        const activeThemeId = themeIds.find((themeId) => themeId === settings.theme);
        const themeId = activeThemeId ?? themeIds[0] ?? ext.manifest.id;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "theme",
          isInstalled: ext.isInstalled,
          isActive: ext.isEnabled && Boolean(activeThemeId),
          isEnabled: ext.isEnabled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          icon: resolveManifestIcon(
            ext.manifest.icon,
            activeThemeId,
            themeContributions[0]?.id,
            themeContributions[0]?.name,
            ext.manifest.displayName,
            "theme",
          ),
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          selectionId: themeId,
          appearanceOptions: themeContributions.map((theme) => ({
            id: theme.id,
            name: theme.name,
            description: theme.description,
          })),
          contributionSummary: themeContributions.map((theme) => `theme:${theme.id}`),
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
          isActive: ext.isEnabled && Boolean(activeIconThemeId),
          isEnabled: ext.isEnabled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          icon: resolveManifestIcon(
            ext.manifest.icon,
            iconContributions[0]?.id,
            iconContributions[0]?.name,
            ext.manifest.displayName,
            "icon-theme",
          ),
          runtimeIssues: ext.runtimeIssues,
          packageSize: resolvePackageSize(ext.manifest),
          selectionId: iconThemeId,
          appearanceOptions: iconContributions.map((theme) => ({
            id: theme.id,
            name: theme.name,
            description: theme.description,
          })),
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
          isEnabled: ext.isEnabled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: true,
          isBundled: false,
          icon: resolveManifestIcon(
            ext.manifest.icon,
            aiProviderContributions[0]?.id,
            aiProviderContributions[0]?.name,
            ext.manifest.displayName,
          ),
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
        isEnabled: true,
        isActive: settings.theme === theme.id,
        version: "1.0.0",
        icon: getCatalogIconUrl(theme.id, theme.name, "theme"),
        selectionId: theme.id,
        appearanceOptions: [
          {
            id: theme.id,
            name: theme.name,
            description: theme.description,
          },
        ],
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
        isEnabled: true,
        isActive: settings.iconTheme === iconTheme.id,
        version: "1.0.0",
        icon: getCatalogIconUrl(iconTheme.id, iconTheme.name, "icon-theme"),
        selectionId: iconTheme.id,
        appearanceOptions: [
          {
            id: iconTheme.id,
            name: iconTheme.name,
            description: iconTheme.description,
          },
        ],
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
        isEnabled: true,
        version: skill.version || (skill.source === "marketplace" ? undefined : "Local"),
        publisher: skill.author || (skill.source === "marketplace" ? "Marketplace" : "You"),
        isMarketplace: skill.source === "marketplace",
        icon: getCatalogIconUrl(skill.title, skill.author, "codex"),
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
        isEnabled: false,
        version: skill.version,
        publisher: skill.author,
        isMarketplace: true,
        icon: getCatalogIconUrl(skill.title, skill.author, "codex"),
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
        isEnabled: agent.installed,
        extensions: [agent.binaryName],
        publisher: "Marketplace",
        isMarketplace: true,
        agentId: agent.id,
        icon: resolveManifestIcon(agent.icon ?? undefined, agent.id, agent.name, agent.binaryName),
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

  const handleUseAppearance = async (extension: UnifiedExtension, selectionId?: string) => {
    const settingKey = getAppearanceSettingKey(extension);
    if (!settingKey || !extension.isInstalled) {
      return;
    }

    const nextSelectionId = selectionId ?? extension.selectionId ?? extension.id;

    try {
      if (!extension.isEnabled) {
        await enableExtension(extension.id);
      }
      await updateSetting(settingKey, nextSelectionId);
      showToast({
        message: `${getAppearanceOptionLabel(extension, nextSelectionId)} selected`,
        type: "success",
        duration: 2500,
      });
    } catch (error) {
      console.error(`Failed to use ${extension.name}:`, error);
      showToast({
        message: `Failed to use ${extension.name}: ${getErrorMessage(error)}`,
        type: "error",
        duration: 5000,
      });
    }
    setTimeout(() => loadAllExtensions(), 100);
  };

  const handleActivateExtension = async (extension: UnifiedExtension) => {
    if (!extension.isInstalled || extension.isEnabled) {
      return;
    }

    try {
      await enableExtension(extension.id);
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
  };

  const handleDeactivateExtension = async (extension: UnifiedExtension) => {
    if (!extension.isInstalled || !extension.isEnabled) {
      return;
    }

    try {
      await disableExtension(extension.id);
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
      if (!extension.isEnabled) {
        await handleActivateExtension(extension);
        return;
      }

      if (extension.isActive) {
        return;
      }

      await handleUseAppearance(extension);
      return;
    }

    if (extension.isInstalled) {
      try {
        if (extension.isEnabled) {
          await disableExtension(extension.id);
        } else {
          await enableExtension(extension.id);
        }
        showToast({
          message: `${extension.name} ${extension.isEnabled ? "deactivated" : "activated"}`,
          type: "success",
          duration: 2500,
        });
      } catch (error) {
        console.error(
          `Failed to ${extension.isEnabled ? "deactivate" : "activate"} ${extension.name}:`,
          error,
        );
        showToast({
          message: `Failed to ${extension.isEnabled ? "deactivate" : "activate"} ${extension.name}: ${getErrorMessage(error)}`,
          type: "error",
          duration: 5000,
        });
      }
      setTimeout(() => loadAllExtensions(), 100);
      return;
    }

    if (extension.isMarketplace) {
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
      return;
    }

    setTimeout(() => loadAllExtensions(), 100);
  };

  const handleUninstall = async (extension: UnifiedExtension) => {
    if (extension.category === "agent" || extension.category === "skill") {
      await handleToggle(extension);
      return;
    }

    if (!extension.isMarketplace || !extension.isInstalled) {
      return;
    }

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

  const extensionContextMenuItems = useMemo<MenuItem[]>(() => {
    const extension = extensionContextMenu.data;
    if (!extension) return [];

    const items: MenuItem[] = [];
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

    if (extension.isInstalled && extension.category !== "agent" && extension.category !== "skill") {
      if (isAppearance) {
        if (!extension.isEnabled) {
          items.push({
            id: "activate",
            label: "Activate",
            icon: <Check className="size-3.5 text-accent" weight="bold" />,
            disabled: isInstalling,
            onClick: () => {
              void handleActivateExtension(extension);
            },
          });
        } else {
          items.push({
            id: "deactivate",
            label: "Deactivate",
            icon: <XCircle className="size-3.5" weight="duotone" />,
            disabled: isInstalling,
            onClick: () => {
              void handleDeactivateExtension(extension);
            },
          });
        }

        const settingKey = getAppearanceSettingKey(extension);
        const currentSelection = settingKey ? settings[settingKey] : undefined;
        const appearanceOptions = extension.appearanceOptions?.length
          ? extension.appearanceOptions
          : extension.selectionId
            ? [{ id: extension.selectionId, name: extension.name }]
            : [];

        if (appearanceOptions.length > 0) {
          if (items.length > 0) {
            items.push({ id: "sep-appearance", label: "", separator: true, onClick: () => {} });
          }

          for (const option of appearanceOptions) {
            const isCurrent = currentSelection === option.id;
            items.push({
              id: `use-${option.id}`,
              label: isCurrent ? `Current: ${option.name}` : `Use ${option.name}`,
              icon: (
                <Check className="size-3.5 text-accent" weight={isCurrent ? "bold" : "regular"} />
              ),
              disabled: isCurrent || isInstalling,
              onClick: () => {
                void handleUseAppearance(extension, option.id);
              },
            });
          }
        } else if (extension.isEnabled) {
          items.push({
            id: extension.isActive ? "active" : "use",
            label: extension.isActive ? "Current" : "Use",
            icon: <Check className="size-3.5 text-accent" weight="bold" />,
            disabled: extension.isActive || isInstalling,
            onClick: () => {
              void handleUseAppearance(extension);
            },
          });
        }
      } else {
        items.push({
          id: extension.isEnabled ? "deactivate" : "activate",
          label: extension.isEnabled ? "Deactivate" : "Activate",
          icon: extension.isEnabled ? (
            <XCircle className="size-3.5" weight="duotone" />
          ) : (
            <Check className="size-3.5 text-accent" weight="bold" />
          ),
          disabled: isInstalling,
          onClick: () => {
            void handleToggle(extension);
          },
        });
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

    if (!extension.isInstalled) {
      items.push({
        id: "install",
        label: primaryActionLabel,
        icon: <Download className="size-3.5" weight="fill" />,
        disabled: isInstalling || isUnavailableAgent,
        onClick: () => {
          void handleToggle(extension);
        },
      });
    } else if (extension.category === "agent" || extension.category === "skill") {
      items.push({
        id: "toggle",
        label: primaryActionLabel,
        icon: <Trash className="size-3.5" weight="duotone" />,
        disabled: isInstalling,
        className: "text-error hover:text-error",
        onClick: () => {
          void handleToggle(extension);
        },
      });
    } else if (extension.isMarketplace) {
      items.push({
        id: "uninstall",
        label: "Uninstall",
        icon: <Trash className="size-3.5" weight="duotone" />,
        disabled: isInstalling,
        className: "text-error hover:text-error",
        onClick: () => {
          void handleUninstall(extension);
        },
      });
    }

    return items;
  }, [extensionContextMenu.data, extensionsWithUpdates, installingAgentIds, availableExtensions]);

  return (
    <div className="font-sans flex h-full min-h-0 flex-col bg-primary-bg">
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
            <SearchField
              ref={searchInputRef}
              autoFocus
              value={searchQuery}
              onChange={setSearchQuery}
              leftIcon={Search}
              placeholder="Search extensions"
              size="md"
              containerClassName="min-w-0 flex-1 sm:w-80 sm:flex-none"
              className="h-9 bg-secondary-bg/45"
            />
            {settings.extensionsActiveTab === "skill" ? (
              <Button variant="default" size="xs" onClick={() => setIsSkillsCommandOpen(true)}>
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
              <Button
                key={tab.id}
                type="button"
                variant={active ? "default" : "ghost"}
                active={active}
                size="xs"
                className={cn(
                  "group h-8 shrink-0 gap-1.5 px-2.5",
                  active ? "bg-selected text-text" : "text-text-lighter",
                )}
                onClick={() => void updateSetting("extensionsActiveTab", tab.id as ExtensionTabId)}
              >
                {Icon ? <Icon className="size-3.5" weight={active ? "fill" : "duotone"} /> : null}
                {tab.label}
                <Badge
                  variant={active ? "accent" : "default"}
                  size="compact"
                  className="h-4 min-w-4 px-1"
                >
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(380px,1fr)_minmax(340px,440px)]">
        <div className="custom-scrollbar-thin min-h-0 overflow-y-auto border-border/70 border-r p-5">
          {settings.extensionsActiveTab === "skill" && isLoadingSkills ? (
            <div className="mb-3">
              <Spinner label="Loading skills" showLabel compact />
            </div>
          ) : null}

          {settings.extensionsActiveTab === "agent" && isLoadingAgents ? (
            <div className="mb-3">
              <Spinner label="Loading agents" showLabel compact />
            </div>
          ) : null}

          {filteredExtensions.length === 0 ? (
            <SidebarEmptyState>No extensions found.</SidebarEmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-8 xl:gap-y-2">
              {filteredExtensions.map((extension) => {
                const isInstalling = isExtensionInstalling(extension);
                const hasUpdate = hasExtensionUpdate(extension);
                const hasRuntimeIssue = Boolean(extension.runtimeIssues?.length);

                return (
                  <ExtensionRow
                    key={extension.id}
                    extension={extension}
                    selected={selectedExtension?.id === extension.id}
                    onSelect={() => setSelectedExtensionId(extension.id)}
                    onToggle={() => handleToggle(extension)}
                    onUpdate={() => handleUpdate(extension)}
                    onContextMenu={handleExtensionContextMenu}
                    isInstalling={isInstalling}
                    hasUpdate={hasUpdate}
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
                <ExtensionIcon extension={selectedExtension} />
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
                {selectedExtension.isInstalled && !selectedExtension.isEnabled ? (
                  <Badge variant="default" size="compact">
                    Disabled
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
                <div className="rounded-lg border border-error/25 bg-error/8 p-3 text-error ui-text-sm">
                  {selectedExtension.runtimeIssues[0]?.message}
                </div>
              ) : null}

              {isAppearanceExtension(selectedExtension) &&
              selectedExtension.appearanceOptions?.length ? (
                <div className="border-border/70 border-t pt-4">
                  <div className="mb-2 font-medium text-text ui-text-sm">
                    {selectedExtension.category === "theme" ? "Themes" : "Icon themes"}
                  </div>
                  <div className="space-y-2">
                    {selectedExtension.appearanceOptions.map((option) => {
                      const currentSelection =
                        selectedExtension.category === "theme"
                          ? settings.theme
                          : settings.iconTheme;
                      const isCurrent = currentSelection === option.id;

                      return (
                        <div
                          key={option.id}
                          className="flex min-w-0 items-center gap-3 rounded-lg border border-border/65 bg-primary-bg px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-text ui-text-sm">
                              {option.name}
                            </div>
                            {option.description ? (
                              <div className="mt-0.5 line-clamp-1 text-text-lighter ui-text-sm">
                                {option.description}
                              </div>
                            ) : null}
                          </div>
                          <Button
                            variant={isCurrent ? "default" : "accent"}
                            size="xs"
                            active={isCurrent}
                            disabled={!selectedExtension.isInstalled || isCurrent}
                            onClick={() => void handleUseAppearance(selectedExtension, option.id)}
                          >
                            <Check />
                            {isCurrent
                              ? "Current"
                              : selectedExtension.isEnabled
                                ? "Use"
                                : "Activate and use"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
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
                          : selectedExtension.isInstalled &&
                              (selectedExtension.category === "agent" ||
                                selectedExtension.category === "skill")
                            ? "ghost"
                            : selectedExtension.isInstalled && selectedExtension.isEnabled
                              ? "default"
                              : "accent"
                    }
                    className={
                      selectedExtension.isInstalled &&
                      (selectedExtension.category === "agent" ||
                        selectedExtension.category === "skill")
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
                    ) : selectedExtension.isInstalled &&
                      (selectedExtension.category === "agent" ||
                        selectedExtension.category === "skill") ? (
                      <Trash />
                    ) : selectedExtension.isInstalled && selectedExtension.isEnabled ? (
                      <XCircle />
                    ) : selectedExtension.isInstalled ? (
                      <Check />
                    ) : (
                      <Download weight="fill" />
                    )}
                    {getPrimaryActionLabel(selectedExtension)}
                  </Button>
                ) : null}
                {selectedExtension.isMarketplace &&
                selectedExtension.isInstalled &&
                selectedExtension.category !== "agent" &&
                selectedExtension.category !== "skill" ? (
                  <Button
                    variant="ghost"
                    className="text-text-lighter hover:text-error"
                    onClick={() => void handleUninstall(selectedExtension)}
                    disabled={isExtensionInstalling(selectedExtension)}
                  >
                    <Trash />
                    Uninstall
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
                    onClick={() => void handleDeactivateExtension(selectedExtension)}
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
                    <Badge key={item} variant="default">
                      {item}
                    </Badge>
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

      <Dropdown
        isOpen={extensionContextMenu.isOpen}
        point={extensionContextMenu.position}
        items={extensionContextMenuItems}
        onClose={extensionContextMenu.close}
      />
    </div>
  );
};
