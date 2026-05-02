import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretLeft as ChevronLeft } from "@phosphor-icons/react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import {
  type KeybindingPreset,
  keybindingPresetDefinitions,
  keybindingPresetOptions,
} from "@/features/keymaps/defaults/keybinding-presets";
import {
  type OnboardingContext,
  type OnboardingMode,
} from "@/features/onboarding/lib/onboarding-state";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Select from "@/ui/select";
import Switch from "@/ui/switch";

interface OnboardingDialogProps {
  context: OnboardingContext;
  onClose: () => void;
  onComplete: () => Promise<void>;
}

interface StepDescriptor {
  id: "privacy" | "preferences";
  title: string;
  description: string;
}

const stepTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.16, ease: "easeOut" },
} as const;

function getModeCopy(mode: OnboardingMode, currentVersion: string, previousVersion?: string) {
  if (mode === "updated") {
    return {
      privacyDescription: previousVersion
        ? `Updated from ${previousVersion}. Anonymous usage telemetry is off by default.`
        : "Anonymous usage telemetry is off by default.",
    };
  }

  if (mode === "preview") {
    return {
      privacyDescription: "Anonymous usage telemetry is off by default.",
    };
  }

  return {
    privacyDescription: "Anonymous usage telemetry is off by default.",
  };
}

export default function OnboardingDialog({ context, onClose, onComplete }: OnboardingDialogProps) {
  const { settings, updateSetting } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const [currentStep, setCurrentStep] = useState(0);
  const [telemetry, setTelemetry] = useState(settings.telemetry);
  const [syncSystemTheme, setSyncSystemTheme] = useState(settings.syncSystemTheme);
  const [vimMode, setVimMode] = useState(settings.vimMode);
  const [openFoldersInNewWindow, setOpenFoldersInNewWindow] = useState(
    settings.openFoldersInNewWindow,
  );
  const [horizontalTabScroll, setHorizontalTabScroll] = useState(settings.horizontalTabScroll);
  const [keybindingPreset, setKeybindingPreset] = useState<KeybindingPreset>(
    settings.keybindingPreset,
  );
  const modeCopy = getModeCopy(context.mode, context.currentVersion, context.previousVersion);

  useEffect(() => {
    setTelemetry(settings.telemetry);
    setSyncSystemTheme(settings.syncSystemTheme);
    setVimMode(settings.vimMode);
    setOpenFoldersInNewWindow(settings.openFoldersInNewWindow);
    setHorizontalTabScroll(settings.horizontalTabScroll);
    setKeybindingPreset(settings.keybindingPreset);
  }, [
    context.mode,
    settings.horizontalTabScroll,
    settings.keybindingPreset,
    settings.openFoldersInNewWindow,
    settings.syncSystemTheme,
    settings.telemetry,
    settings.vimMode,
  ]);

  const steps: StepDescriptor[] = [
    {
      id: "privacy",
      title: "Telemetry",
      description: modeCopy.privacyDescription,
    },
    {
      id: "preferences",
      title: "Workspace defaults",
      description: "Pick the few defaults you want now.",
    },
  ];

  const activeStep = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const persistSelections = async () => {
    await Promise.all([
      updateSetting("telemetry", telemetry),
      updateSetting("syncSystemTheme", syncSystemTheme),
      updateSetting("vimMode", vimMode),
      updateSetting("openFoldersInNewWindow", openFoldersInNewWindow),
      updateSetting("horizontalTabScroll", horizontalTabScroll),
      updateSetting("keybindingPreset", keybindingPreset),
    ]);
  };

  const handleFinish = async (openFolderAfterFinish: boolean) => {
    await persistSelections();
    await onComplete();

    if (openFolderAfterFinish) {
      await handleOpenFolder();
    }
  };

  const renderStepContent = () => {
    if (activeStep.id === "privacy") {
      return (
        <div className="mx-auto max-w-[440px] rounded-lg bg-secondary-bg px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="ui-font ui-text-sm font-medium text-text">
                Share anonymous telemetry
              </div>
              <p className="ui-font ui-text-sm mt-1 text-text-light">
                Heartbeats, extension metadata, and crash reports. Minimal update-check metadata is
                always sent.
              </p>
            </div>
            <Switch checked={telemetry} onChange={setTelemetry} />
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-[440px] space-y-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-lg bg-secondary-bg px-4 py-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="ui-font ui-text-sm text-text">Keybinding preset</div>
              <p className="ui-font ui-text-sm mt-1 text-text-light">
                {keybindingPresetDefinitions[keybindingPreset].description}
              </p>
            </div>
            <Select
              value={keybindingPreset}
              onChange={(value) => setKeybindingPreset(value as KeybindingPreset)}
              options={keybindingPresetOptions}
              size="sm"
              variant="outline"
              aria-label="Keybinding preset"
            />
          </div>
        </motion.div>

        {[
          {
            title: "Sync with system theme",
            checked: syncSystemTheme,
            onChange: setSyncSystemTheme,
          },
          {
            title: "Enable Vim mode",
            checked: vimMode,
            onChange: setVimMode,
          },
          {
            title: "Open folders in a new window",
            checked: openFoldersInNewWindow,
            onChange: setOpenFoldersInNewWindow,
          },
          {
            title: "Enable buffer carousel",
            checked: horizontalTabScroll,
            onChange: setHorizontalTabScroll,
          },
        ].map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: index * 0.04 }}
            className="flex items-center justify-between gap-4 rounded-lg bg-secondary-bg px-4 py-3"
          >
            <div className="ui-font ui-text-sm text-text">{item.title}</div>
            <Switch checked={item.checked} onChange={item.onChange} />
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <Dialog
      title="Setup Athas"
      onClose={onClose}
      size="lg"
      headerBorder={false}
      classNames={{
        backdrop: "bg-black/20 backdrop-blur-[1px]",
        modal: "max-w-[560px] border-0 shadow-2xl",
        content: "px-5 pb-5 pt-0",
      }}
    >
      <div className="flex h-[360px] flex-col bg-primary-bg">
        <div className="px-1 pb-2 pt-2 text-center">
          <div className="ui-font ui-text-lg font-medium text-text">{activeStep.title}</div>
          <p className="ui-font ui-text-sm mt-1 text-text-light">{activeStep.description}</p>
        </div>

        <div className="flex flex-1 items-center">
          <AnimatePresence mode="wait">
            <motion.div key={activeStep.id} {...stepTransition} className="w-full py-2">
              {renderStepContent()}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="min-w-[88px]">
            {currentStep > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentStep((step) => step - 1)}
              >
                <ChevronLeft />
                Back
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-center gap-2">
            {steps.map((step, index) => {
              const isActive = index === currentStep;

              return (
                <Button
                  key={step.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setCurrentStep(index)}
                  className="ui-text-sm"
                  aria-label={`Go to step ${index + 1}`}
                >
                  {index + 1}
                </Button>
              );
            })}
          </div>

          <div className="flex min-w-[88px] justify-end">
            {!isLastStep ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentStep((step) => step + 1)}
              >
                Continue
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void handleFinish(true)}>
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
