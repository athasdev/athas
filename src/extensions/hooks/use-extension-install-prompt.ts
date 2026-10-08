import { useEffect, useRef } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { recordFrictionSignal } from "@/features/telemetry/services/telemetry";
import { emitAppEvent, onAppEvent } from "@/utils/app-events";
import { useExtensionStore } from "../registry/extension-store";

export interface ExtensionInstallRequest {
  extensionId: string;
  extensionName: string;
  filePath: string;
}

// Track active prompts at module level to persist across re-renders
const activePrompts = new Map<string, string>();

export const useExtensionInstallPrompt = () => {
  const { showToast, dismissToast, updateToast, hasToast } = useToast();
  const { installExtension } = useExtensionStore.use.actions();
  const dismissedExtensions = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleInstallNeeded = (request: ExtensionInstallRequest) => {
      const { extensionId, extensionName } = request;

      // Check if already installed in store (synchronous check to handle timing issues)
      const { installedExtensions } = useExtensionStore.getState();
      if (installedExtensions.has(extensionId)) {
        return;
      }

      // Don't show if user already dismissed this extension prompt in this session
      if (dismissedExtensions.current.has(extensionId)) {
        return;
      }

      // Don't show multiple toasts for the same extension
      const existingToastId = activePrompts.get(extensionId);
      if (existingToastId && hasToast(existingToastId)) {
        return;
      }

      const toastId = showToast({
        message: `${extensionName} integration not installed. Install it to enable language support?`,
        type: "info",
        duration: 0, // Don't auto-dismiss
        action: {
          label: "Install",
          onClick: async () => {
            try {
              // Update toast to show installing status
              updateToast(toastId, {
                message: `Installing ${extensionName}...`,
                action: undefined, // Remove action button while installing
              });

              // Install the extension
              await installExtension(extensionId);
              activePrompts.delete(extensionId);

              // Show success
              updateToast(toastId, {
                message: `${extensionName} installed successfully!`,
                type: "success",
              });

              // Auto-dismiss success message after 3 seconds
              setTimeout(() => {
                dismissToast(toastId);
              }, 3000);
            } catch (error) {
              // Show error
              const errorMessage = error instanceof Error ? error.message : "Installation failed";
              console.error(`Failed to install ${extensionName}:`, error);

              updateToast(toastId, {
                message: `Failed to install ${extensionName}: ${errorMessage}`,
                type: "error",
                action: {
                  label: "Retry",
                  onClick: () => {
                    void recordFrictionSignal({ area: "extensions", signal: "retry" });
                    // Retry installation
                    activePrompts.delete(extensionId);
                    dismissToast(toastId);
                    emitAppEvent("extension-install-needed", request);
                  },
                },
              });
            }
          },
        },
      });

      activePrompts.set(extensionId, toastId);
    };

    const handleToastDismiss = ({ toastId }: { toastId: string }) => {
      // Find and remove the extension from activePrompts if its toast was dismissed
      for (const [extId, tId] of activePrompts.entries()) {
        if (tId === toastId) {
          activePrompts.delete(extId);
          // Mark as dismissed so we don't show again this session
          dismissedExtensions.current.add(extId);
          void recordFrictionSignal({ area: "extensions", signal: "prompt_dismissed" });
          break;
        }
      }
    };

    const unsubscribeInstallNeeded = onAppEvent("extension-install-needed", handleInstallNeeded);
    const unsubscribeToastDismissed = onAppEvent("toast-dismissed", handleToastDismiss);

    return () => {
      unsubscribeInstallNeeded();
      unsubscribeToastDismissed();
    };
  }, [showToast, dismissToast, updateToast, installExtension, hasToast]);
};
