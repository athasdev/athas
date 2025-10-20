import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSettingsStore } from "@/settings/store";

interface CliInstallPromptProps {
  isVisible: boolean;
  onClose: () => void;
}

const CliInstallPrompt = ({ isVisible, onClose }: CliInstallPromptProps) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const { showToast } = useToast();
  const { updateSetting } = useSettingsStore();

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const result = await invoke<string>("install_cli_command");
      showToast({ message: result, type: "success" });
      await updateSetting("hasPromptedCliInstall", true);
      onClose();
    } catch (error) {
      showToast({
        message: `Failed to install CLI: ${error}. You may need administrator privileges.`,
        type: "error",
      });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleSkip = async () => {
    await updateSetting("hasPromptedCliInstall", true);
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-primary-bg p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <Terminal size={24} className="text-accent" />
          <h2 className="font-mono text-lg text-text">Install CLI Command?</h2>
        </div>

        <p className="mb-4 font-mono text-sm text-text-light leading-relaxed">
          Would you like to install the <span className="font-semibold text-accent">athas</span>{" "}
          command for your terminal? This allows you to open Athas from anywhere by typing{" "}
          <span className="rounded bg-secondary-bg px-1 font-mono text-accent">athas</span> in your
          terminal.
        </p>

        <div className="mb-4 rounded border border-border bg-secondary-bg p-3">
          <p className="font-mono text-text-lighter text-xs">Example usage:</p>
          <code className="mt-1 block font-mono text-accent text-xs">$ athas</code>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleInstall}
            disabled={isInstalling}
            variant="ghost"
            className="flex-1 bg-accent text-primary-bg hover:bg-accent/90"
            size="sm"
          >
            {isInstalling ? "Installing..." : "Install"}
          </Button>
          <Button
            onClick={handleSkip}
            disabled={isInstalling}
            variant="ghost"
            className="bg-secondary-bg"
            size="sm"
          >
            Skip
          </Button>
        </div>

        <p className="mt-3 font-mono text-text-lighter text-xs">
          You can install this later from Settings or the Command Palette.
        </p>
      </div>
    </div>
  );
};

export default CliInstallPrompt;
