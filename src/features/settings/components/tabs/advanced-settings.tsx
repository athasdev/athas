import { usePerformanceExperiments } from "../../stores/performance-experiments.store";
import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { createSettingsExportPayload } from "@/features/settings/lib/settings-import-export";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  clearTelemetryLogEntries,
  getTelemetryLogEntries,
  subscribeToTelemetryLog,
  type TelemetryLogEntry,
} from "@/features/telemetry/services/telemetry";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import Switch from "@/ui/switch";
import { TextLink } from "@/ui/text-link";
import Section, { SettingBlock, SettingsView, SettingRow } from "../settings-section";
import { getServiceUrls } from "@/config/services";

const telemetryDescription = "Never includes file paths, prompts, or code.";
const telemetryLearnMoreUrl = getServiceUrls().telemetryDocsUrl;

function getTelemetryStatusVariant(status: TelemetryLogEntry["status"]): BadgeTone {
  if (status === "failed") return "danger";
  if (status === "sent") return "success";
  if (status === "local") return "accent";
  return "neutral";
}

export const AdvancedSettings = () => {
  const webgpu = usePerformanceExperiments.use.webgpu();
  const showMonitor = usePerformanceExperiments.use.showMonitor();
  const { toggleWebgpu, toggleMonitor } = usePerformanceExperiments.use.actions();
  const telemetry = useSettingsStore((state) => state.settings.telemetry);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const resetToDefaults = useSettingsStore((state) => state.actions.resetToDefaults);
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
        const imported = useSettingsStore.getState().actions.updateSettingsFromJSON(text);

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
    <SettingsView>
      <Section title="Performance experiments">
        <SettingRow label="Experimental WebGPU renderer" description="Falls back to DOM rendering">
          <Switch checked={webgpu} onChange={toggleWebgpu} />
        </SettingRow>
        <SettingRow label="Show performance monitor">
          <Switch checked={showMonitor} onChange={toggleMonitor} />
        </SettingRow>
      </Section>
      <Section title="Data">
        <SettingRow label="Export Settings">
          <Button variant="default" onClick={() => void handleExportSettings()}>
            Export
          </Button>
        </SettingRow>
        <SettingRow label="Import Settings">
          <Button variant="default" onClick={handleImportSettings}>
            Import
          </Button>
        </SettingRow>
      </Section>
      <Section title="Telemetry">
        <SettingRow
          label="Anonymous Usage Telemetry"
          description={
            <>
              {telemetryDescription}{" "}
              <TextLink href={telemetryLearnMoreUrl} target="_blank" rel="noopener noreferrer">
                Learn more
              </TextLink>
            </>
          }
        >
          <Switch checked={telemetry} onChange={(checked) => updateSetting("telemetry", checked)} />
        </SettingRow>
        <SettingRow label="Telemetry Log">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={handleClearTelemetryLog}>
              Clear
            </Button>
            <Button variant="default" onClick={() => setShowTelemetryLog((value) => !value)}>
              {showTelemetryLog ? "Hide" : "Show"}
            </Button>
          </div>
        </SettingRow>
        {showTelemetryLog ? (
          telemetryLog.length === 0 ? (
            <EmptyState variant="section" message="No entries yet" />
          ) : (
            <SettingBlock className="max-h-72 overflow-y-auto">
              <ItemGroup>
                {[...telemetryLog].reverse().map((entry) => (
                  <Item key={entry.id} size="compact">
                    <ItemContent>
                      <ItemTitle>{entry.eventType}</ItemTitle>
                      <ItemDescription>{entry.error || entry.summary}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge tone={getTelemetryStatusVariant(entry.status)}>{entry.status}</Badge>
                      <time className="font-sans ui-text-sm text-subtle-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </time>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </SettingBlock>
          )
        ) : null}
      </Section>
      <Section title="Reset" tone="danger">
        <SettingRow label="Reset Settings" description="Restores every setting to its default">
          <TypedConfirmAction actionLabel="Reset" onConfirm={handleResetSettings} />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
