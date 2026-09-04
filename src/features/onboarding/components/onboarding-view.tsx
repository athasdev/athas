import { FolderOpenIcon as FolderOpen } from "@/ui/icons";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { IdeSettingsImportDialog } from "@/features/file-system/components/ide-settings-import-dialog";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  type KeybindingPreset,
  keybindingPresetDefinitions,
  keybindingPresetOptions,
} from "@/features/keymaps/defaults/keybinding-presets";
import { markOnboardingCompleted } from "@/features/onboarding/lib/onboarding-state";
import type { OnboardingContext } from "@/features/onboarding/lib/onboarding-state";
import { buildOnboardingViewModel } from "@/features/onboarding/lib/onboarding-view-model";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { formatReleaseDate } from "@/features/settings/lib/whats-new";
import { SettingsView, SettingRow } from "@/features/settings/components/settings-section";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { Button } from "@/ui/button";
import { ScrollArea } from "@/ui/scroll-area";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { TextLink } from "@/ui/text-link";
import { getServiceUrls } from "@/config/services";
import { ReleaseNotesContent } from "./release-notes-content";

const telemetryDescription =
  "Athas sends anonymous operational metadata for updates and, when enabled, heartbeats, extensions, and crashes; it never sends file paths, project names, prompts, or editor content.";
const telemetryLearnMoreUrl = getServiceUrls().telemetryDocsUrl;

interface OnboardingViewProps {
  bufferId: string;
  context: OnboardingContext;
}

export default function OnboardingView({ bufferId, context }: OnboardingViewProps) {
  const settings = useSettingsStore(
    useShallow((state) => ({
      keybindingPreset: state.settings.keybindingPreset,
      openFoldersInNewWindow: state.settings.openFoldersInNewWindow,
      telemetry: state.settings.telemetry,
      vimMode: state.settings.vimMode,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const closeBufferForce = useBufferStore.use.actions().closeBufferForce;
  const whatsNewInitialized = useWhatsNewStore((state) => state.initialized);
  const whatsNewInfo = useWhatsNewStore((state) => state.info);
  const completeOnboarding = useOnboardingStore((state) => state.actions.complete);
  const viewModel = buildOnboardingViewModel(context);
  const [telemetry, setTelemetry] = useState(settings.telemetry);
  const [vimMode, setVimMode] = useState(settings.vimMode);
  const [openFoldersInNewWindow, setOpenFoldersInNewWindow] = useState(
    settings.openFoldersInNewWindow,
  );
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [keybindingPreset, setKeybindingPreset] = useState<KeybindingPreset>(
    settings.keybindingPreset,
  );

  useEffect(() => {
    setTelemetry(settings.telemetry);
    setVimMode(settings.vimMode);
    setOpenFoldersInNewWindow(settings.openFoldersInNewWindow);
    setKeybindingPreset(settings.keybindingPreset);
  }, [
    settings.keybindingPreset,
    settings.openFoldersInNewWindow,
    settings.telemetry,
    settings.vimMode,
  ]);

  const persistSelections = async () => {
    await Promise.all([
      updateSetting("telemetry", telemetry),
      updateSetting("vimMode", vimMode),
      updateSetting("openFoldersInNewWindow", openFoldersInNewWindow),
      updateSetting("keybindingPreset", keybindingPreset),
    ]);
  };

  const handleFinish = async (openFolderAfterFinish: boolean) => {
    if (viewModel.showSettings) {
      await persistSelections();
    }

    if (context.mode === "first-run") {
      const trackedContext = useOnboardingStore.getState().context;
      if (trackedContext?.currentVersion === context.currentVersion) {
        await completeOnboarding();
      } else {
        await markOnboardingCompleted(context.currentVersion);
      }
    }

    closeBufferForce(bufferId);

    if (openFolderAfterFinish) {
      await handleOpenFolder();
    }
  };

  const handlePrimaryAction = async () => {
    await handleFinish(viewModel.primaryAction === "open-folder");
  };

  const releaseInfo =
    whatsNewInfo?.version === context.currentVersion
      ? {
          ...whatsNewInfo,
          previousVersion: whatsNewInfo.previousVersion ?? context.previousVersion,
        }
      : {
          version: context.currentVersion,
          previousVersion: context.previousVersion,
        };

  return (
    <ScrollArea className="size-full bg-background">
      <div className="mx-auto flex w-full max-w-205 flex-col px-8 py-10">
        <div className={viewModel.showSettings ? "mb-7" : "mb-6"}>
          <h1 className="font-sans ui-text-base font-semibold text-foreground">
            {viewModel.title}
          </h1>
          {viewModel.showSettings ? (
            <p className="font-sans ui-text-sm mt-2 text-muted-foreground">
              {viewModel.description}
            </p>
          ) : (
            <div className="font-sans ui-text-sm mt-2 flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <span>{viewModel.description}</span>
              {releaseInfo.date ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Released {formatReleaseDate(releaseInfo.date)}</span>
                </>
              ) : null}
            </div>
          )}
        </div>

        {viewModel.showSettings ? (
          <SettingsView>
            <SettingRow
              label="Keybinding preset"
              description={keybindingPresetDefinitions[keybindingPreset].description}
            >
              <Select
                value={keybindingPreset}
                onChange={(value) => setKeybindingPreset(value as KeybindingPreset)}
                options={keybindingPresetOptions}
                variant="default"
                aria-label="Keybinding preset"
              />
            </SettingRow>

            <SettingRow
              label="Share anonymous telemetry"
              description={
                <>
                  {telemetryDescription}{" "}
                  <TextLink href={telemetryLearnMoreUrl} target="_blank" rel="noopener noreferrer">
                    Learn more
                  </TextLink>
                </>
              }
            >
              <Switch checked={telemetry} onChange={setTelemetry} />
            </SettingRow>

            <SettingRow label="Enable Vim mode">
              <Switch checked={vimMode} onChange={setVimMode} />
            </SettingRow>

            <SettingRow label="Open folders in a new window">
              <Switch checked={openFoldersInNewWindow} onChange={setOpenFoldersInNewWindow} />
            </SettingRow>

            <SettingRow
              label="Import settings from another editor"
              description="Import matching setup from VS Code, Cursor, Windsurf, Zed, or JetBrains."
            >
              <Button variant="default" onClick={() => setIsImportDialogOpen(true)}>
                Import
              </Button>
            </SettingRow>
          </SettingsView>
        ) : (
          <div className="min-w-0">
            <ReleaseNotesContent
              info={releaseInfo}
              loading={!whatsNewInitialized || whatsNewInfo?.version !== context.currentVersion}
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {viewModel.secondaryLabel ? (
            <Button variant="ghost" onClick={() => void handleFinish(false)}>
              {viewModel.secondaryLabel}
            </Button>
          ) : null}
          <Button variant="accent" onClick={() => void handlePrimaryAction()}>
            {viewModel.primaryAction === "open-folder" && <FolderOpen />}
            {viewModel.primaryLabel}
          </Button>
        </div>
      </div>

      {isImportDialogOpen && (
        <IdeSettingsImportDialog onClose={() => setIsImportDialogOpen(false)} />
      )}
    </ScrollArea>
  );
}
