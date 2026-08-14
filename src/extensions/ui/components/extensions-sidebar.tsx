import {
  BrainIcon as Brain,
  PackageIcon as Package,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
} from "@/ui/icons";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { SkillsCommand } from "@/features/ai/components/skills/skills-command";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGenerateStore } from "@/features/generate/stores/generate.store";
import {
  createSkillFromMarketplace,
  hasMarketplaceSkillUpdate,
  loadMarketplaceSkills,
  resetSkillLocalOverride,
  updateSkillFromMarketplace,
} from "@/features/ai/lib/skill-library";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  Dropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import {
  SidebarHeaderIconButton,
  SidebarPanel,
  SidebarSearchPopover,
  SidebarSection,
  SidebarTitleBar,
} from "@/ui/sidebar";

import { buildExtensionCatalog } from "./build-extension-catalog";
import { EXTENSION_CATEGORIES, type UnifiedExtension } from "./extension-catalog-types";
import {
  getAppearanceOptionLabel,
  getAppearanceSettingKey,
  getErrorMessage,
  isAppearanceExtension,
} from "./extension-catalog-utils";
import { buildExtensionContextMenuItems } from "./extension-context-menu-items";
import { ExtensionDetailView } from "./extension-detail-view";
import { ExtensionListItem } from "./extension-list-item";

const ExtensionsView = ({ extensionId }: { extensionId?: string }) => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiSkills: state.settings.aiSkills,
      iconTheme: state.settings.iconTheme,
      theme: state.settings.theme,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [installingAgentIds, setInstallingAgentIds] = useState<Set<string>>(new Set());
  const [isSkillsCommandOpen, setIsSkillsCommandOpen] = useState(false);
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
  const openExtensionBuffer = useBufferStore.use.actions().openExtensionBuffer;
  const activeExtensionId = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extension" ? activeBuffer.extensionId : null;
  });

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
  const categorySections = EXTENSION_CATEGORIES.map((category) => ({
    ...category,
    extensions: searchMatchedExtensions.filter((extension) => extension.category === category.id),
  })).filter((section) => section.extensions.length > 0);
  const selectedExtension = extensionId
    ? (extensions.find((extension) => extension.id === extensionId) ?? null)
    : null;
  const installedCount = extensions.filter((extension) => extension.isInstalled).length;

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

  const extensionDetail = (
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
  );

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
        <ScrollArea className="min-h-0 flex-1">{extensionDetail}</ScrollArea>
        {overlays}
      </div>
    );
  }

  return (
    <>
      <SidebarPanel className="font-sans select-none">
        <SidebarTitleBar title="Extensions">
          <SidebarSearchPopover
            value={searchQuery}
            onChange={setSearchQuery}
            open={isSearchOpen}
            onOpenChange={setIsSearchOpen}
            aria-label="Search extensions"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarHeaderIconButton tooltip="Add" tooltipSide="bottom" aria-label="Add" />
              }
            >
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setIsSearchOpen(true)}>
                <Package />
                Add Extension
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
        </SidebarTitleBar>

        <div className="px-4 pb-1 text-subtle-foreground ui-text-sm">
          {searchMatchedExtensions.length} extension
          {searchMatchedExtensions.length === 1 ? "" : "s"}
          {updateCount > 0
            ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"}`
            : installedCount > 0
              ? ` · ${installedCount} installed`
              : ""}
        </div>

        <ScrollArea className="min-h-0 flex-1" contentClassName="px-2 py-2">
          {isLoadingSkills || isLoadingAgents ? (
            <EmptyState
              layout="sidebar"
              message={<Spinner label="Loading extensions" showLabel compact />}
            />
          ) : searchMatchedExtensions.length === 0 ? (
            <EmptyState layout="sidebar" message="No extensions found." />
          ) : (
            <div className="overflow-x-hidden">
              {categorySections.map((section) => (
                <SidebarSection
                  key={section.id}
                  title={section.label}
                  count={section.extensions.length}
                  forceExpanded={normalizedSearchQuery.length > 0}
                >
                  {section.extensions.map((extension) => (
                    <ExtensionListItem
                      key={extension.id}
                      extension={extension}
                      selected={activeExtensionId === extension.id}
                      onSelect={() => openExtensionBuffer(extension.id, extension.name)}
                      onContextMenu={handleExtensionContextMenu}
                      isInstalling={isExtensionInstalling(extension)}
                      hasUpdate={hasExtensionUpdate(extension)}
                      hasRuntimeIssue={Boolean(extension.runtimeIssues?.length)}
                    />
                  ))}
                </SidebarSection>
              ))}
            </div>
          )}
        </ScrollArea>
      </SidebarPanel>
      {overlays}
    </>
  );
};

export const ExtensionsSidebar = () => <ExtensionsView />;

export const ExtensionDetails = ({ extensionId }: { extensionId: string }) => (
  <ExtensionsView extensionId={extensionId} />
);
