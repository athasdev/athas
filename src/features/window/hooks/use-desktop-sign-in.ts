import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "@/ui/toast";
import { useAuthStore } from "@/features/window/stores/auth-store";
import {
  beginDesktopAuthSession,
  DesktopAuthError,
  waitForDesktopAuthToken,
} from "@/features/window/services/auth-api";

interface UseDesktopSignInOptions {
  onSuccess?: () => void;
}

export function useDesktopSignIn(options: UseDesktopSignInOptions = {}) {
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const signIn = async () => {
    setIsSigningIn(true);

    try {
      const { sessionId, pollSecret, loginUrl } = await beginDesktopAuthSession();
      await openUrl(loginUrl);
      toast.info("Complete sign-in in your browser. Waiting for confirmation...");

      const token = await waitForDesktopAuthToken(sessionId, pollSecret);
      await handleAuthCallback(token);
      toast.success("Signed in successfully!");
      options.onSuccess?.();
    } catch (error) {
      if (error instanceof DesktopAuthError && error.code === "endpoint_unavailable") {
        toast.error(
          "Desktop sign-in endpoint is unavailable on this server. Please use the local dev www server.",
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
