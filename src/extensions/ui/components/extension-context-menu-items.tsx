import {
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as Reset,
  CheckIcon as Check,
  DownloadSimpleIcon as Download,
  TrashIcon as Trash,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import type { MenuItem } from "@/ui/dropdown";
import { hasSkillLocalOverride } from "@/features/ai/lib/skill-library";
import type { UnifiedExtension } from "./extension-catalog-types";
import {
  getAppearanceSettingKey,
  getPrimaryActionLabel,
  isAppearanceExtension,
} from "./extension-catalog-utils";

type ExtensionAction = (extension: UnifiedExtension) => void | Promise<void>;

export function buildExtensionContextMenuItems({
  extension,
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
}: {
  extension: UnifiedExtension | null;
  settings: { theme: string; iconTheme: string };
  isExtensionInstalling: (extension: UnifiedExtension) => boolean;
  hasExtensionUpdate: (extension: UnifiedExtension) => boolean;
  handleActivateExtension: ExtensionAction;
  handleDeactivateExtension: ExtensionAction;
  handleUseAppearance: (extension: UnifiedExtension, selectionId?: string) => void | Promise<void>;
  handleToggle: ExtensionAction;
  handleUpdate: ExtensionAction;
  handleResetSkillOverride: ExtensionAction;
  handleUninstall: ExtensionAction;
}): MenuItem[] {
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
      icon: <Check className="size-3.5 text-primary" />,
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
          icon: <Check className="size-3.5 text-primary" weight="bold" />,
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
          items.push({ id: "sep-appearance", separator: true });
        }

        for (const option of appearanceOptions) {
          const isCurrent = currentSelection === option.id;
          items.push({
            id: `use-${option.id}`,
            label: isCurrent ? `Current: ${option.name}` : `Use ${option.name}`,
            icon: (
              <Check className="size-3.5 text-primary" weight={isCurrent ? "bold" : "regular"} />
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
          icon: <Check className="size-3.5 text-primary" weight="bold" />,
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
          <Check className="size-3.5 text-primary" weight="bold" />
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
    items.push({ id: "sep-primary-action", separator: true });
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
      tone: "destructive",
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
      tone: "destructive",
      onClick: () => {
        void handleUninstall(extension);
      },
    });
  }

  return items;
}
