import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToast } from "@/features/layout/contexts/toast-context";
import { createCoreFeaturesList } from "@/features/settings/config/features";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { createSettingsExportPayload } from "@/features/settings/lib/settings-import-export";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import type { CoreFeature } from "@/features/settings/types/feature.types";
import {
  clearTelemetryLogEntries,
  getTelemetryLogEntries,
  subscribeToTelemetryLog,
  type TelemetryLogEntry,
} from "@/features/telemetry/services/telemetry";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";
import { getServiceUrls } from "@/config/services";

const telemetryDescription =
  "Athas sends anonymous operational metadata for updates and, when enabled, heartbeats, extensions, and crashes; it never sends file paths, project names, prompts, or editor content.";
const telemetryLearnMoreUrl = getServiceUrls().telemetryDocsUrl;

export const AdvancedSettings = () => {
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const telemetry = useSettingsStore((state) => state.settings.telemetry);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);
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
  const defaultCoreFeatures = getDefaultSetting("coreFeatures");
  const coreFeaturesList = createCoreFeaturesList(coreFeatures).filter(
    (feature: CoreFeature) => feature.id !== "git",
  );

  const handleCoreFeatureToggle = (featureId: string, enabled: boolean) => {
    updateSetting("coreFeatures", {
      ...coreFeatures,
      [featureId]: enabled,
    });
  };

  const handleResetFeature = (featureId: string) => {
    updateSetting("coreFeatures", {
      ...coreFeatures,
      [featureId]: defaultCoreFeatures[featureId as keyof typeof defaultCoreFeatures],
    });
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
      <Section title="Features" description="Toggle application features on or off">
        {coreFeaturesList.map((feature: CoreFeature) => (
          <SettingRow
            key={feature.id}
            label={feature.name}
            labelAccessory={
              feature.status === "experimental" ? (
                <Badge variant="accent" size="compact" className="uppercase">
                  Experimental
                </Badge>
              ) : undefined
            }
            description={feature.description}
            onReset={() => handleResetFeature(feature.id)}
            canReset={
              feature.enabled !==
              defaultCoreFeatures[feature.id as keyof typeof defaultCoreFeatures]
            }
          >
            <Switch
              checked={feature.enabled}
              onChange={(checked) => handleCoreFeatureToggle(feature.id, checked)}
              size="sm"
            />
          </SettingRow>
        ))}
      </Section>
      <Section title="Data">
        <SettingRow label="Export Settings" description="Save all app settings to a JSON file.">
          <Button variant="default" onClick={() => void handleExportSettings()}>
            Export
          </Button>
        </SettingRow>
        <SettingRow
          label="Import Settings"
          description="Restore app settings from an Athas settings JSON file."
        >
          <Button variant="default" onClick={handleImportSettings} size="xs">
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
          description={
            <>
              {telemetryDescription}{" "}
              <a
                href={telemetryLearnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:underline"
              >
                Learn more
              </a>
            </>
          }
        >
          <Switch
            checked={telemetry}
            onChange={(checked) => updateSetting("telemetry", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Telemetry Log"
          description="Inspect the local queue and recent telemetry delivery results."
        >
          <div className="flex gap-2">
            <Button variant="default" onClick={() => setShowTelemetryLog((value) => !value)}>
              {showTelemetryLog ? "Hide Log" : "Open Log"}
            </Button>
            <Button variant="default" onClick={handleClearTelemetryLog} size="xs">
              Clear
            </Button>
          </div>
        </SettingRow>
        {showTelemetryLog && (
          <div className="rounded-lg border border-border/70 bg-primary-bg/50">
            {telemetryLog.length === 0 ? (
              <p className="font-sans ui-text-base px-3 py-2 text-text-lighter">
                No telemetry entries yet.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {[...telemetryLog].reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className="font-sans ui-text-base flex items-center gap-2 border-border/70 px-3 py-2 text-text not-last:border-b"
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
