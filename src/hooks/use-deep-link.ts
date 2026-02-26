import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
import { completeKairoOAuthCallback, KAIRO_AUTH_UPDATED_EVENT } from "@/utils/kairo-auth";

/**
 * Hook to handle deep link URLs
 * Supports:
 *   athas://extension/install/{extensionId}
 *   athas://auth/callback?token={token}
 *   athas://kairo/callback?code={code}&state={state}
 */
export function useDeepLink() {
  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        handleDeepLink(url);
      }
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, []);
}

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "athas:") {
      return;
    }

    const pathSegments = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const segments = [parsed.hostname, ...pathSegments].filter(Boolean);

    if (segments[0] === "extension" && segments[1] === "install" && segments[2]) {
      const extensionId = segments[2];
      installExtensionFromDeepLink(extensionId);
    } else if (segments[0] === "auth" && segments[1] === "callback") {
      const tokenParam = parsed.searchParams.get("token");
      if (tokenParam) {
        handleAuthCallback(tokenParam);
      }
    } else if (segments[0] === "kairo" && segments[1] === "callback") {
      handleKairoAuthCallback(parsed.searchParams);
    }
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}

async function installExtensionFromDeepLink(extensionId: string) {
  const { installExtension } = useExtensionStore.getState().actions;
  const { availableExtensions } = useExtensionStore.getState();

  const extension = availableExtensions.get(extensionId);

  if (!extension) {
    toast.error(`Extension "${extensionId}" not found`);
    return;
  }

  if (extension.isInstalled) {
    toast.info(`${extension.manifest.displayName} is already installed`);
    return;
  }

  try {
    toast.info(`Installing ${extension.manifest.displayName}...`);
    await installExtension(extensionId);
    toast.success(`${extension.manifest.displayName} installed successfully`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    toast.error(`Failed to install extension: ${message}`);
  }
}

async function handleAuthCallback(token: string) {
  try {
    await useAuthStore.getState().handleAuthCallback(token);
    toast.success("Signed in successfully!");
  } catch {
    toast.error("Authentication failed. Please try again.");
  }
}

async function handleKairoAuthCallback(searchParams: URLSearchParams) {
  try {
    await completeKairoOAuthCallback(searchParams);
    window.dispatchEvent(new CustomEvent(KAIRO_AUTH_UPDATED_EVENT));
    toast.success("Kairo Code connected successfully!");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    toast.error(`Kairo Code login failed: ${message}`);
  }
}
