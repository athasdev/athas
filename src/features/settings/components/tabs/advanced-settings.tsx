import { usePerformanceExperiments } from "../../stores/performance-experiments.store";
import { useEffect, useState } from "react";
import { saveTextFileWithDialog } from "@/utils/file-dialogs";
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
  const showMonitor = usePerformanceExperiments.use.showMonitor();
  const { toggleMonitor } = usePerformanceExperiments.use.actions();
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
      const targetPath = await saveTextFileWithDialog(
        {
          defaultPath: "athas-settings.json",
          filters: [
            { name: "JSON", extensions: ["json"] },
            { name: "All Files", extensions: ["*"] },
          ],
        },
        () =>
          JSON.stringify(
            createSettingsExportPayload(useSettingsStore.getState().settings),
            null,
            2,
          ),
      );

      if (!targetPath) {
        return;
      }

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
        <SettingRow label="Show performance monitor">
          <Switch checked={showMonitor} onChange={toggleMonitor} />
        </SettingRow>
      </Section>
      <Section title="Data">
        <SettingRow label="Export Settings">
          <Button variant="outline" onClick={() => void handleExportSettings()}>
            Export
          </Button>
        </SettingRow>
        <SettingRow label="Import Settings">
          <Button variant="outline" onClick={handleImportSettings}>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleClearTelemetryLog}>
              Clear
            </Button>
            <Button variant="outline" onClick={() => setShowTelemetryLog((value) => !value)}>
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
          <TypedConfirmAction
            actionLabel="Reset"
            variant="danger"
            onConfirm={handleResetSettings}
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
