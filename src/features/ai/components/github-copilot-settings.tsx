import { open } from "@tauri-apps/plugin-shell";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotAuthStore } from "@/features/ai/store/copilot-auth-store";
import { useUIState } from "@/stores/ui-state-store";
import Button from "@/ui/button";

const GitHubCopilotSettings = () => {
  const { isGitHubCopilotSettingsVisible, setIsGitHubCopilotSettingsVisible } = useUIState();

  const {
    stage,
    userCode,
    verificationUri,
    expiresAt,
    pollInterval,
    isAuthenticated,
    availableModels,
    error,
    startSignIn,
    pollForAuth,
    cancelSignIn,
    signOut,
    checkAuthStatus,
  } = useCopilotAuthStore();

  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isVisible = isGitHubCopilotSettingsVisible;
  const onClose = () => setIsGitHubCopilotSettingsVisible(false);

  useEffect(() => {
    if (isVisible) {
      checkAuthStatus();
    }
  }, [isVisible, checkAuthStatus]);

  useEffect(() => {
    if (stage === "polling" && expiresAt) {
      pollIntervalRef.current = setInterval(async () => {
        const success = await pollForAuth();
        if (success) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
        }
      }, pollInterval * 1000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [stage, pollInterval, pollForAuth, expiresAt]);

  useEffect(() => {
    if (expiresAt && (stage === "awaiting_code" || stage === "polling")) {
      const timer = setInterval(() => {
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        setTimeRemaining(remaining);

        if (remaining === 0) {
          clearInterval(timer);
          cancelSignIn();
        }
      }, 1000);

      return () => clearInterval(timer);
    }
    setTimeRemaining(null);
  }, [expiresAt, stage, cancelSignIn]);

  const handleCopyCode = useCallback(async () => {
    if (userCode) {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [userCode]);

  const handleOpenGitHub = useCallback(() => {
    if (verificationUri) {
      open(verificationUri);
    }
  }, [verificationUri]);

  const handleSignIn = useCallback(async () => {
    await startSignIn();
  }, [startSignIn]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const handleCancel = useCallback(() => {
    cancelSignIn();
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
  }, [cancelSignIn]);

  if (!isVisible) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const renderContent = () => {
    if (isAuthenticated && stage === "authenticated") {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/10 p-3">
            <Check size={16} className="text-green-500" />
            <span className="font-medium text-green-500 text-sm">Connected to GitHub Copilot</span>
          </div>

          {availableModels.length > 0 && (
            <div className="space-y-2 rounded border border-border bg-secondary-bg p-3">
              <div className="font-medium text-text text-xs">Available Models</div>
              <div className="flex flex-wrap gap-1">
                {availableModels.slice(0, 8).map((model) => (
                  <span
                    key={model.id}
                    className="rounded bg-hover px-2 py-0.5 text-text-lighter text-xs"
                  >
                    {model.name || model.id}
                  </span>
                ))}
                {availableModels.length > 8 && (
                  <span className="rounded bg-hover px-2 py-0.5 text-text-lighter text-xs">
                    +{availableModels.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSignOut} variant="outline" className="flex-1 gap-2">
              <LogOut size={14} />
              Sign Out
            </Button>
            <Button onClick={onClose} variant="default" className="flex-1">
              Done
            </Button>
          </div>
        </div>
      );
    }

    if (stage === "awaiting_code" || stage === "polling" || stage === "exchanging_token") {
      return (
        <div className="space-y-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            Enter this code on GitHub to authorize Athas:
          </div>

          <div className="flex flex-col items-center gap-3 rounded border border-border bg-secondary-bg p-4">
            <div className="font-bold font-mono text-2xl text-text tracking-widest">
              {userCode || "--------"}
            </div>

            <Button
              onClick={handleCopyCode}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!userCode}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy Code"}
            </Button>
          </div>

          <Button onClick={handleOpenGitHub} variant="default" className="w-full gap-2">
            <ExternalLink size={14} />
            Open GitHub
          </Button>

          <div className="flex items-center justify-center gap-2 text-text-lighter text-xs">
            {stage === "exchanging_token" ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Completing authorization...</span>
              </>
            ) : (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Waiting for authorization...</span>
                {timeRemaining !== null && (
                  <span className="text-text-lighter">({formatTime(timeRemaining)})</span>
                )}
              </>
            )}
          </div>

          <Button onClick={handleCancel} variant="ghost" className="w-full" size="sm">
            Cancel
          </Button>
        </div>
      );
    }

    if (stage === "error") {
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
            <div className="space-y-1">
              <div className="font-medium text-red-500 text-sm">Authentication Failed</div>
              <div className="text-red-400 text-xs">{error}</div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSignIn} variant="default" className="flex-1 gap-2">
              <RefreshCw size={14} />
              Try Again
            </Button>
            <Button onClick={onClose} variant="outline" className="flex-1">
              Close
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="text-text-lighter text-xs leading-relaxed">
          Sign in with your GitHub account to use Copilot models. Requires an active GitHub Copilot
          subscription.
        </div>

        <div className="space-y-2 rounded border border-border bg-secondary-bg p-3">
          <div className="mb-2 font-medium text-text text-xs">What you get:</div>
          <ul className="list-inside list-disc space-y-1 text-text-lighter text-xs">
            <li>Access to GPT-5, Claude, Gemini and more</li>
            <li>Usage based on your Copilot plan</li>
            <li>Secure OAuth authentication</li>
          </ul>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSignIn} variant="default" className="flex-1 gap-2">
            <Zap size={14} />
            Sign in with GitHub
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center">
      <div
        className="pointer-events-auto mx-4 w-full max-w-md rounded-lg border border-border bg-primary-bg shadow-2xl"
        style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)" }}
      >
        <div className="flex items-center gap-3 border-border border-b px-4 py-3">
          <Zap size={16} className="text-text" />
          <h2 className="ui-font font-medium text-sm text-text">GitHub Copilot</h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-text-lighter transition-colors hover:text-text"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4">{renderContent()}</div>
      </div>
    </div>
  );
};

export default GitHubCopilotSettings;
