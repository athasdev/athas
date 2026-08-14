import { useEffect, useState, type ReactNode } from "react";
import {
  BrainIcon as Brain,
  DatabaseIcon as Database,
  PackageIcon as Package,
  PaintBrushIcon as PaintBrush,
  PlugsConnectedIcon as PlugsConnected,
  RobotIcon as Robot,
  SparkleIcon as Sparkles,
  TextTIcon as TextT,
} from "@/ui/icons";
import { DynamicIcon } from "./dynamic-icon";
import { cn } from "@/utils/cn";
import type { UnifiedExtension } from "./extension-catalog-types";

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
  "claude-acp": "claude",
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
  sentry: "sentry",
  gitlab: "gitlab",
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

function normalizeIconLookupKey(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getIconLookupCandidates(iconId: string | undefined | null): string[] {
  const normalized = normalizeIconLookupKey(iconId);
  if (!normalized) return [];
  const stripped = normalizeIconLookupKey(
    normalized
      .replace(/-/g, " ")
      .replace(/\b(?:provider|language support|language|theme|icons?|cli|code)\b/g, " "),
  );
  const candidates = [
    normalized,
    stripped,
    normalized.replace(/-/g, ""),
    stripped.replace(/-/g, ""),
  ];
  return Array.from(
    new Set(
      candidates
        .filter(Boolean)
        .flatMap((candidate) => [
          candidate,
          LOCAL_ICON_ALIASES[candidate],
          SIMPLE_ICON_SLUGS[candidate],
        ]),
    ),
  ).filter(Boolean) as string[];
}

function getLocalFileIconUrl(iconId: string | undefined | null): string | undefined {
  for (const candidate of getIconLookupCandidates(iconId)) {
    const url = LOCAL_FILE_ICON_URLS.get(candidate);
    if (url) return url;
  }
  return undefined;
}

function getSimpleIconUrl(iconId: string | undefined | null): string | undefined {
  const slug = getIconLookupCandidates(iconId).find((candidate) => SIMPLE_ICON_SLUGS[candidate]);
  return slug
    ? `https://cdn.simpleicons.org/${SIMPLE_ICON_SLUGS[slug]}/${SIMPLE_ICON_COLOR}`
    : undefined;
}

export function getCatalogIconUrl(
  ...iconIds: Array<string | undefined | null>
): string | undefined {
  for (const iconId of iconIds) {
    const icon = getSimpleIconUrl(iconId) ?? getLocalFileIconUrl(iconId);
    if (icon) return icon;
  }
  return undefined;
}

export function resolveManifestIcon(
  manifestIcon: string | undefined,
  ...fallbackIconIds: Array<string | undefined | null>
): string | undefined {
  const trimmedIcon = manifestIcon?.trim();
  const iconFileName = trimmedIcon?.split(/[?#]/)[0]?.split("/").pop()?.toLowerCase();
  if (!trimmedIcon || iconFileName === "icon.svg") {
    return getCatalogIconUrl(...fallbackIconIds) ?? trimmedIcon;
  }
  return trimmedIcon;
}

function getCategoryIcon(category: UnifiedExtension["category"]): ReactNode {
  const className = "size-4 text-subtle-foreground";
  const icons = {
    language: <TextT className={className} weight="duotone" />,
    theme: <PaintBrush className={className} weight="duotone" />,
    "icon-theme": <Package className={className} weight="duotone" />,
    database: <Database className={className} weight="duotone" />,
    ai: <Sparkles className={className} weight="duotone" />,
    integration: <PlugsConnected className={className} weight="duotone" />,
    skill: <Brain className={className} weight="duotone" />,
    agent: <Robot className={className} weight="duotone" />,
  };
  return icons[category];
}

function isImageIcon(icon: string): boolean {
  return (
    /^(?:[a-z]+:)?\/\//i.test(icon) ||
    icon.startsWith("/") ||
    icon.startsWith("data:") ||
    /\.(?:svg|png|jpe?g|webp)(?:[?#].*)?$/i.test(icon)
  );
}

export function ExtensionIcon({
  extension,
  compact = false,
}: {
  extension: UnifiedExtension;
  compact?: boolean;
}) {
  const [failedImageIcon, setFailedImageIcon] = useState(false);
  const icon = extension.icon?.trim();
  const showImageIcon = Boolean(icon && isImageIcon(icon) && !failedImageIcon);
  const showNamedIcon = Boolean(icon && !isImageIcon(icon) && !icon.includes("/"));

  useEffect(() => setFailedImageIcon(false), [icon]);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border border-border/60",
        compact ? "size-7 rounded-md" : "size-12",
        showImageIcon ? "bg-white/95" : "bg-background",
      )}
    >
      {showImageIcon ? (
        <img
          alt=""
          className={cn("object-contain", compact ? "size-4" : "size-7")}
          draggable={false}
          src={icon}
          onError={() => setFailedImageIcon(true)}
        />
      ) : showNamedIcon && icon ? (
        <DynamicIcon
          name={icon}
          className={cn("text-subtle-foreground", compact ? "size-4" : "size-5")}
        />
      ) : (
        getCategoryIcon(extension.category)
      )}
    </span>
  );
}
