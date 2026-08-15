import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import {
  createSkillFromMarketplace,
  resetSkillLocalOverride,
  resolveMarketplaceSkill,
  updateSkillFromMarketplace,
} from "@/features/ai/lib/skill-library";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { UnifiedExtension } from "../components/extension-catalog-types";
import {
  getAppearanceOptionLabel,
  getAppearanceSettingKey,
  getErrorMessage,
  isAppearanceExtension,
} from "../components/extension-catalog-utils";

interface ExtensionCatalogActionSettings {
  aiSkills: AIChatSkill[];
}

export function useExtensionCatalogActions(settings: ExtensionCatalogActionSettings) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [installingAgentIds, setInstallingAgentIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const {
    installExtension,
    uninstallExtension,
    enableExtension,
    disableExtension,
    updateExtension,
  } = useExtensionStore.use.actions();

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

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const handleUpdate = async (extension: UnifiedExtension) => {
    if (extension.category === "skill") {
      if (!extension.skill || !extension.marketplaceSkill) return;

      try {
        const marketplaceSkill = await resolveMarketplaceSkill(extension.marketplaceSkill);
        const updatedSkill = updateSkillFromMarketplace(extension.skill, marketplaceSkill);
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
    if (!settingKey || !extension.isInstalled) return;

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
    if (!extension.isInstalled || extension.isEnabled) return;

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
    if (!extension.isInstalled || !extension.isEnabled) return;

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
          message: `Failed to ${extension.isInstalled ? "uninstall" : "install"} ${extension.name}: ${getErrorMessage(error)}`,
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

        if (!extension.marketplaceSkill) return;

        const marketplaceSkill = await resolveMarketplaceSkill(extension.marketplaceSkill);

        await updateSetting("aiSkills", [
          createSkillFromMarketplace(marketplaceSkill),
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
      if (extension.isActive) return;
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

    if (!extension.isMarketplace) return;

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
  };

  const handleUninstall = async (extension: UnifiedExtension) => {
    if (extension.category === "agent" || extension.category === "skill") {
      await handleToggle(extension);
      return;
    }
    if (!extension.isMarketplace || !extension.isInstalled) return;

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

  const isExtensionInstalling = (extension: UnifiedExtension) =>
    extension.category === "agent" &&
    installingAgentIds.has(extension.agentId ?? extension.id.replace(/^agent:/, ""));

  return {
    agents,
    isLoadingAgents,
    isExtensionInstalling,
    handleActivateExtension,
    handleDeactivateExtension,
    handleUseAppearance,
    handleToggle,
    handleUninstall,
    handleUpdate,
    handleResetSkillOverride,
  };
}
