import { FolderOpenIcon as FolderOpen } from "@/ui/icons";
import { useEffect, useState, type ReactNode } from "react";
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
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { Button } from "@/ui/button";
import { ScrollArea } from "@/ui/scroll-area";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { getServiceUrls } from "@/config/services";

const telemetryDescription =
  "Athas sends anonymous operational metadata for updates and, when enabled, heartbeats, extensions, and crashes; it never sends file paths, project names, prompts, or editor content.";
const telemetryLearnMoreUrl = getServiceUrls().telemetryDocsUrl;

interface OnboardingViewProps {
  bufferId: string;
  context: OnboardingContext;
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-border/70 border-b px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="font-sans ui-text-sm font-medium text-text">{title}</div>
        {description ? (
          <p className="font-sans ui-text-sm mt-1 max-w-[560px] text-text-light">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
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
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const closeBufferForce = useBufferStore.use.actions().closeBufferForce;
  const openWhatsNew = useWhatsNewStore((state) => state.open);
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

    if (context.mode !== "preview") {
      await markOnboardingCompleted(context.currentVersion);
    }

    closeBufferForce(bufferId);

    if (openFolderAfterFinish) {
      await handleOpenFolder();
    }
  };

  const handlePrimaryAction = async () => {
    if (viewModel.primaryAction === "open-whats-new") {
      await handleFinish(false);
      await openWhatsNew();
      return;
    }

    await handleFinish(true);
  };

  return (
    <ScrollArea className="h-full w-full bg-primary-bg">
      <div className="mx-auto flex w-full max-w-[820px] flex-col px-8 py-10">
        <div className="mb-7">
          <h1 className="font-sans ui-text-base font-semibold text-text">{viewModel.title}</h1>
          <p className="font-sans ui-text-sm mt-2 text-text-light">{viewModel.description}</p>
        </div>

        {viewModel.showSettings ? (
          <div className="overflow-hidden rounded-lg border border-border/70 bg-secondary-bg/45">
            <SettingRow
              title="Keybinding preset"
              description={keybindingPresetDefinitions[keybindingPreset].description}
            >
              <Select
                value={keybindingPreset}
                onChange={(value) => setKeybindingPreset(value as KeybindingPreset)}
                options={keybindingPresetOptions}
                size="sm"
                variant="default"
                aria-label="Keybinding preset"
              />
            </SettingRow>

            <SettingRow
              title="Share anonymous telemetry"
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
              <Switch checked={telemetry} onChange={setTelemetry} />
            </SettingRow>

            <SettingRow title="Enable Vim mode">
              <Switch checked={vimMode} onChange={setVimMode} />
            </SettingRow>

            <SettingRow title="Open folders in a new window">
              <Switch checked={openFoldersInNewWindow} onChange={setOpenFoldersInNewWindow} />
            </SettingRow>

            <SettingRow
              title="Import settings from another editor"
              description="Import matching setup from VS Code, Cursor, Windsurf, Zed, or JetBrains."
            >
              <Button variant="default" onClick={() => setIsImportDialogOpen(true)}>
                Import
              </Button>
            </SettingRow>
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 bg-secondary-bg/45 px-5 py-4">
            <div className="font-sans ui-text-sm font-medium text-text">
              Your settings are unchanged
            </div>
            <p className="font-sans ui-text-sm mt-1 text-text-light">
              Existing editor, privacy, keyboard, and window preferences remain in place after this
              update.
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => void handleFinish(false)}>
            {viewModel.secondaryLabel}
          </Button>
          <Button variant="accent" onClick={() => void handlePrimaryAction()}>
            {viewModel.primaryAction !== "open-whats-new" && <FolderOpen />}
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
