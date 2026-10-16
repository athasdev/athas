import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { buildExtensionCatalog } from "@/extensions/ui/components/build-extension-catalog";
import { ExtensionIconGraphic } from "@/extensions/ui/components/extension-catalog-icon";
import {
  EXTENSION_CATEGORIES,
  type ExtensionCatalogActions,
  type UnifiedExtension,
} from "@/extensions/ui/components/extension-catalog-types";
import {
  getCategoryLabel,
  isAppearanceExtension,
} from "@/extensions/ui/components/extension-catalog-utils";
import { useExtensionCatalogActions } from "@/extensions/ui/hooks/use-extension-catalog-actions";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { menuSeparator, type MenuItem } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { GroupedSection } from "@/ui/grouped-section";
import {
  ArrowUpIcon,
  BoltIcon,
  BoltSlashIcon,
  CheckIcon,
  InfoIcon,
  PackageIcon,
  TrashIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesCustomizeQuery } from "../services/customize-catalog";
import type { CustomizeTab } from "../types/customize.types";
import { CustomizeAddButton, CustomizeMoreMenu, CustomizeRow } from "./customize-row";

/** Agents and skills have their own Customize pages, so Extensions lists everything else. */
const EDITOR_CATEGORIES = EXTENSION_CATEGORIES.filter(
  (category) => category.id !== "agent" && category.id !== "skill",
);

export function extensionMenuItems(
  extension: UnifiedExtension,
  actions: ExtensionCatalogActions,
): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: "details",
      label: "Details",
      icon: <InfoIcon />,
      onClick: () =>
        useBufferStore.getState().actions.openExtensionBuffer(extension.id, extension.name),
    },
  ];
  if (isAppearanceExtension(extension) && extension.isEnabled && !extension.isActive) {
    items.push({
      id: "use",
      label: "Use",
      icon: <CheckIcon />,
      onClick: () => void actions.applyAppearance(extension),
    });
  }
  if (actions.hasUpdate(extension)) {
    items.push({
      id: "update",
      label: "Update",
      icon: <ArrowUpIcon />,
      onClick: () => void actions.update(extension),
    });
  }
  if (extension.isMarketplace) {
    items.push({
      id: "enabled",
      label: extension.isEnabled ? "Turn off" : "Turn on",
      icon: extension.isEnabled ? <BoltSlashIcon /> : <BoltIcon />,
      onClick: () =>
        void (extension.isEnabled ? actions.deactivate(extension) : actions.activate(extension)),
    });
    items.push(menuSeparator("uninstall-separator"), {
      id: "uninstall",
      label: "Uninstall",
      icon: <TrashIcon />,
      tone: "destructive",
      onClick: () => void actions.uninstall(extension),
    });
  }
  return items;
}

function ExtensionMedia({ extension }: { extension: UnifiedExtension }) {
  if (extension.appearancePreview) return <ExtensionIconGraphic extension={extension} />;
  return (
    <span className="flex size-5 items-center justify-center">
      <ExtensionIconGraphic extension={extension} />
    </span>
  );
}

function ExtensionStatus({
  extension,
  hasUpdate,
}: {
  extension: UnifiedExtension;
  hasUpdate: boolean;
}) {
  if (extension.runtimeIssues?.length) return <Badge tone="danger">Issue</Badge>;
  if (hasUpdate) return <Badge tone="accent">Update</Badge>;
  if (extension.isActive) return <Badge tone="success">In use</Badge>;
  if (extension.isInstalled && !extension.isEnabled) return <Badge>Off</Badge>;
  return null;
}

export function ExtensionsSection({ tab, query }: { tab: CustomizeTab; query: string }) {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiSkills: state.settings.aiSkills,
      theme: state.settings.theme,
      iconTheme: state.settings.iconTheme,
    })),
  );
  const availableExtensions = useExtensionStore.use.availableExtensions();
  const isLoadingRegistry = useExtensionStore.use.isLoadingRegistry();
  const { actions } = useExtensionCatalogActions(settings);

  const extensions = useMemo(
    () =>
      buildExtensionCatalog({
        availableExtensions,
        agents: [],
        marketplaceSkills: [],
        aiSkills: [],
        selectedThemeId: settings.theme,
        selectedIconThemeId: settings.iconTheme,
      }),
    [availableExtensions, settings.iconTheme, settings.theme],
  );

  const groups = EDITOR_CATEGORIES.map((category) => ({
    ...category,
    rows: extensions.filter(
      (extension) =>
        extension.category === category.id &&
        (tab === "catalog" || extension.isInstalled) &&
        matchesCustomizeQuery(query, extension.name, extension.description),
    ),
  })).filter((group) => group.rows.length > 0);

  if (groups.length === 0) {
    return isLoadingRegistry ? (
      <EmptyState
        className="min-h-64"
        message={<Spinner label="Loading extensions" showLabel compact />}
      />
    ) : (
      <EmptyState className="min-h-64" icon={<PackageIcon />} title="No extensions match" />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <GroupedSection key={group.id} title={group.label} variant="grid">
          {group.rows.map((extension) => {
            const hasUpdate = actions.hasUpdate(extension);
            return (
              <CustomizeRow
                key={`${extension.category}:${extension.id}`}
                title={extension.name}
                description={extension.description || getCategoryLabel(extension.category)}
                media={<ExtensionMedia extension={extension} />}
                status={<ExtensionStatus extension={extension} hasUpdate={hasUpdate} />}
                action={
                  extension.isInstalled ? (
                    <CustomizeMoreMenu
                      label={`${extension.name} actions`}
                      items={extensionMenuItems(extension, actions)}
                      busy={actions.isInstalling(extension)}
                    />
                  ) : extension.isMarketplace ? (
                    <CustomizeAddButton
                      label={`Install ${extension.name}`}
                      busy={actions.isInstalling(extension)}
                      onClick={() => void actions.toggle(extension)}
                    />
                  ) : null
                }
              />
            );
          })}
        </GroupedSection>
      ))}
    </div>
  );
}
