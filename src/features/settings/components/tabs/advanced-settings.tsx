import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { createSettingsExportPayload } from "@/features/settings/lib/settings-import-export";
import { useSettingsStore } from "@/features/settings/store";
import {
  clearTelemetryLogEntries,
  getTelemetryLogEntries,
  subscribeToTelemetryLog,
  type TelemetryLogEntry,
} from "@/features/telemetry/services/telemetry";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";

export const AdvancedSettings = () => {
  const { settings, updateSetting, resetToDefaults } = useSettingsStore();
  const { showToast } = useToast();
  const [showTelemetryLog, setShowTelemetryLog] = useState(false);
  const [telemetryLog, setTelemetryLog] = useState<TelemetryLogEntry[]>([]);

  useEffect(() => {
    void getTelemetryLogEntries().then(setTelemetryLog);
    return subscribeToTelemetryLog(setTelemetryLog);
  }, []);

  const handleResetSettings = () => {
    resetToDefaults();
    showToast({ message: "Settings reset to defaults", type: "success" });
  };

  const handleClearTelemetryLog = async () => {
    await clearTelemetryLogEntries();
    showToast({ message: "Telemetry log cleared", type: "success" });
  };

  const handleExportSettings = async () => {
    try {
      const targetPath = await save({
        defaultPath: "athas-settings.json",
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!targetPath) {
        return;
      }

      const payload = createSettingsExportPayload(useSettingsStore.getState().settings);
      await writeTextFile(targetPath, JSON.stringify(payload, null, 2));
      showToast({ message: "Settings exported", type: "success" });
    } catch (error) {
      console.error("Failed to export settings:", error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error);

      showToast({
        message: `Failed to export settings: ${message}`,
        type: "error",
      });
    }
  };

  const handleImportSettings = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];

      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        const imported = useSettingsStore.getState().updateSettingsFromJSON(text);

        if (!imported) {
          showToast({ message: "Invalid settings file format", type: "error" });
          return;
        }

        showToast({ message: "Settings imported", type: "success" });
      } catch (error) {
        console.error("Failed to import settings:", error);
        showToast({ message: `Failed to import settings: ${error}`, type: "error" });
      }
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      <Section title="Data">
        <SettingRow label="Export Settings" description="Save all app settings to a JSON file.">
          <Button variant="default" size="xs" onClick={() => void handleExportSettings()}>
            Export
          </Button>
        </SettingRow>
        <SettingRow
          label="Import Settings"
          description="Restore app settings from an Athas settings JSON file."
        >
          <Button variant="default" size="xs" onClick={handleImportSettings}>
            Import
          </Button>
        </SettingRow>
        <SettingRow label="Reset Settings" description="Reset all settings to their default values">
          <TypedConfirmAction actionLabel="Reset" onConfirm={handleResetSettings} />
        </SettingRow>
      </Section>
      <Section title="Telemetry">
        <SettingRow
          label="Anonymous Usage Telemetry"
          description="Send anonymous heartbeat, extension, and crash-report metadata. Minimal update-check metadata is always sent."
        >
          <Switch
            checked={settings.telemetry}
            onChange={(checked) => updateSetting("telemetry", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Telemetry Log"
          description="Inspect the local queue and recent telemetry delivery results."
        >
          <div className="flex gap-2">
            <Button
              variant="default"
              size="xs"
              onClick={() => setShowTelemetryLog((value) => !value)}
            >
              {showTelemetryLog ? "Hide Log" : "Open Log"}
            </Button>
            <Button variant="default" size="xs" onClick={handleClearTelemetryLog}>
              Clear
            </Button>
          </div>
        </SettingRow>
        {showTelemetryLog && (
          <div className="rounded-lg border border-border/70 bg-primary-bg/50">
            {telemetryLog.length === 0 ? (
              <p className="ui-font ui-text-sm px-3 py-2 text-text-lighter">
                No telemetry entries yet.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {[...telemetryLog].reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className="ui-font ui-text-sm flex items-center gap-2 border-border/70 px-3 py-2 text-text not-last:border-b"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.eventType}</span>
                    <span
                      className={
                        entry.status === "failed"
                          ? "shrink-0 uppercase text-error"
                          : entry.status === "sent"
                            ? "shrink-0 uppercase text-success"
                            : "shrink-0 uppercase text-text-lighter"
                      }
                    >
                      {entry.status}
                    </span>
                    <span className="min-w-0 flex-[1.4] truncate text-text-lighter">
                      {entry.error || entry.summary}
                    </span>
                    <span className="shrink-0 text-text-lightest">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
};
