import { useEffect, useRef } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useExtensionStore } from "../registry/extension-store";

export interface ExtensionInstallNeededEvent {
  extensionId: string;
  extensionName: string;
  filePath: string;
}

export const useExtensionInstallPrompt = () => {
  const { showToast, dismissToast, updateToast } = useToast();
  const { installExtension } = useExtensionStore.use.actions();
  const activeToasts = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const handleInstallNeeded = (event: Event) => {
      const customEvent = event as CustomEvent<ExtensionInstallNeededEvent>;
      const { extensionId, extensionName } = customEvent.detail;

      // Don't show multiple toasts for the same extension
      if (activeToasts.current.has(extensionId)) {
        return;
      }

      const toastId = showToast({
        message: `${extensionName} extension not installed. Install it to enable language support?`,
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

              // Show success
              updateToast(toastId, {
                message: `${extensionName} installed successfully!`,
                type: "success",
              });

              // Auto-dismiss success message after 3 seconds
              setTimeout(() => {
                dismissToast(toastId);
                activeToasts.current.delete(extensionId);
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
                    // Retry installation (recursively call the same handler)
                    dismissToast(toastId);
                    activeToasts.current.delete(extensionId);
                    window.dispatchEvent(
                      new CustomEvent("extension-install-needed", {
                        detail: customEvent.detail,
                      }),
                    );
                  },
                },
              });

              activeToasts.current.delete(extensionId);
            }
          },
        },
      });

      activeToasts.current.set(extensionId, toastId);

      // Clean up if user dismisses without action
      const checkDismissed = setInterval(() => {
        if (!document.querySelector(`[data-toast-id="${toastId}"]`)) {
          clearInterval(checkDismissed);
          activeToasts.current.delete(extensionId);
        }
      }, 1000);
    };

    window.addEventListener("extension-install-needed", handleInstallNeeded);

    return () => {
      window.removeEventListener("extension-install-needed", handleInstallNeeded);
    };
  }, [showToast, dismissToast, updateToast, installExtension]);
};
