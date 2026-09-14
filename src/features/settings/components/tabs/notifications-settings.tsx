import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { requestAgentNativeNotificationPermission } from "@/features/ai/services/agent-native-notifications";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Switch from "@/ui/switch";
import Section, { SettingsView, SettingRow } from "../settings-section";

export function NotificationsSettings() {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiAgentNotifications: state.settings.aiAgentNotifications,
      terminalCommandNotifications: state.settings.terminalCommandNotifications,
      terminalShellIntegration: state.settings.terminalShellIntegration,
      githubActionNotifications: state.settings.githubActionNotifications,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { showToast } = useToast();
  const [isUpdatingAgentNotifications, setIsUpdatingAgentNotifications] = useState(false);

  const handleAgentNotificationsChange = async (checked: boolean) => {
    if (!checked) {
      await updateSetting("aiAgentNotifications", false);
      return;
    }

    setIsUpdatingAgentNotifications(true);
    try {
      const permission = await requestAgentNativeNotificationPermission();
      if (permission === "granted") {
        await updateSetting("aiAgentNotifications", true);
        showToast({ message: "Agent notifications enabled", type: "success" });
        return;
      }

      await updateSetting("aiAgentNotifications", false);
      showToast({
        message:
          permission === "denied"
            ? "Native notification permission was not granted"
            : "Native notifications are unavailable",
        type: permission === "denied" ? "warning" : "error",
      });
    } finally {
      setIsUpdatingAgentNotifications(false);
    }
  };

  return (
    <SettingsView>
      <Section title="Activity">
        <SettingRow
          label="Agent Notifications"
          description="Show native notifications when background agent work finishes, fails, or needs approval"
          onReset={() =>
            void handleAgentNotificationsChange(getDefaultSetting("aiAgentNotifications"))
          }
          canReset={settings.aiAgentNotifications !== getDefaultSetting("aiAgentNotifications")}
        >
          <Switch
            checked={settings.aiAgentNotifications}
            onChange={(checked) => void handleAgentNotificationsChange(checked)}
            disabled={isUpdatingAgentNotifications}
          />
        </SettingRow>
        <SettingRow
          label="Command Notifications"
          description="Notify when a command longer than ten seconds finishes in a terminal you are not looking at. Requires shell integration."
          onReset={() =>
            updateSetting(
              "terminalCommandNotifications",
              getDefaultSetting("terminalCommandNotifications"),
            )
          }
          canReset={
            settings.terminalCommandNotifications !==
            getDefaultSetting("terminalCommandNotifications")
          }
        >
          <Switch
            checked={settings.terminalCommandNotifications}
            disabled={!settings.terminalShellIntegration}
            onChange={(checked) => updateSetting("terminalCommandNotifications", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Workflow Run Notifications"
          description="Notify about runs you trigger and pull requests you author, are assigned to, or are asked to review"
          onReset={() =>
            updateSetting(
              "githubActionNotifications",
              getDefaultSetting("githubActionNotifications"),
            )
          }
          canReset={
            settings.githubActionNotifications !== getDefaultSetting("githubActionNotifications")
          }
        >
          <Switch
            checked={settings.githubActionNotifications}
            onChange={(checked) => updateSetting("githubActionNotifications", checked)}
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
}
