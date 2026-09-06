import type { ExtensionRuntimeIssue } from "@/extensions/registry/extension-store-types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import type { AppearancePreview } from "@/extensions/appearance/appearance-preview";

export type ExtensionCategory =
  | "language"
  | "theme"
  | "icon-theme"
  | "database"
  | "ai"
  | "integration"
  | "skill"
  | "agent";

export interface AppearanceOption {
  id: string;
  name: string;
  description?: string;
  preview?: AppearancePreview;
}

export interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: ExtensionCategory;
  isInstalled: boolean;
  isEnabled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  license?: string;
  sourceUrl?: string;
  isMarketplace?: boolean;
  isBundled?: boolean;
  runtimeIssues?: ExtensionRuntimeIssue[];
  skill?: AIChatSkill;
  marketplaceSkill?: MarketplaceSkill;
  agentId?: string;
  icon?: string | null;
  appearancePreview?: AppearancePreview;
  canInstall?: boolean;
  hasUpdate?: boolean;
  installedVersion?: string | null;
  availableVersion?: string | null;
  packageSize?: number;
  contributionSummary?: string[];
  selectionId?: string;
  appearanceOptions?: AppearanceOption[];
  isActive?: boolean;
}

export const EXTENSION_CATEGORIES = [
  { id: "language", label: "Languages" },
  { id: "theme", label: "Themes" },
  { id: "icon-theme", label: "Icon Themes" },
  { id: "database", label: "Databases" },
  { id: "ai", label: "AI" },
  { id: "integration", label: "Integrations" },
  { id: "skill", label: "Skills" },
  { id: "agent", label: "Agents" },
] as const;

type ExtensionAction = (extension: UnifiedExtension) => void | Promise<void>;

/**
 * The single vocabulary every extension surface speaks: the catalog grid, the
 * context menu and the detail view all take this object rather than
 * re-listing the same handlers under their own prop names.
 */
export interface ExtensionCatalogActions {
  isInstalling: (extension: UnifiedExtension) => boolean;
  hasUpdate: (extension: UnifiedExtension) => boolean;
  activate: ExtensionAction;
  deactivate: ExtensionAction;
  applyAppearance: (extension: UnifiedExtension, selectionId?: string) => void | Promise<void>;
  toggle: ExtensionAction;
  update: ExtensionAction;
  uninstall: ExtensionAction;
  resetSkillOverride: ExtensionAction;
}

/** The appearance settings a surface needs to mark the current theme selection. */
export interface AppearanceSelection {
  theme: string;
  iconTheme: string;
}
