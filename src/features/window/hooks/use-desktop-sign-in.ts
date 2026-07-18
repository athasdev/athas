import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/features/window/stores/auth.store";
import {
  beginDesktopAuthSession,
  DesktopAuthError,
  waitForDesktopAuthToken,
} from "@/features/window/services/auth-api";

interface UseDesktopSignInOptions {
  apiBase?: string;
  onSuccess?: () => void;
}

export function useDesktopSignIn(options: UseDesktopSignInOptions = {}) {
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const signIn = async () => {
    setIsSigningIn(true);

    try {
      const { sessionId, pollSecret, loginUrl, apiBase } = await beginDesktopAuthSession({
        apiBase: options.apiBase,
      });
      await openUrl(loginUrl);
      toast.info("Complete sign-in in your browser. Waiting for confirmation...");

      const token = await waitForDesktopAuthToken(sessionId, pollSecret, undefined, {
        apiBase,
      });
      await handleAuthCallback(token);
      toast.success("Signed in successfully!");
      options.onSuccess?.();
    } catch (error) {
      if (error instanceof DesktopAuthError && error.code === "endpoint_unavailable") {
        toast.error(
          "Desktop sign-in endpoint is unavailable. Check the auth server and try again.",
        );
      } else {
        const message = error instanceof Error ? error.message : "Authentication failed.";
        toast.error(message);
      }

      throw error;
    } finally {
      setIsSigningIn(false);
    }
  };

  return {
    isSigningIn,
    signIn,
  };
}
