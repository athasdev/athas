import { AlertCircle, Download } from "lucide-react";
import { platform } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/ui/button";
import { useGitHubStore } from "../stores/github-store";

function getInstallHint(): { label: string; action: () => void } {
  const os = platform();

  if (os === "macos") {
    return {
      label: "brew install gh",
      action: () => void openUrl("https://github.com/cli/cli#macos"),
    };
  }
  if (os === "windows") {
    return {
      label: "winget install GitHub.cli",
      action: () => void openUrl("https://github.com/cli/cli#windows"),
    };
  }
  return {
    label: "Install GitHub CLI",
    action: () => void openUrl("https://github.com/cli/cli#linux--bsd"),
  };
}

export function GitHubCliStatusMessage() {
  const cliStatus = useGitHubStore((s) => s.cliStatus);
  const checkAuth = useGitHubStore((s) => s.actions.checkAuth);
  const install = getInstallHint();

  if (cliStatus === "notInstalled") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4 text-center">
        <Download className="mb-2 text-text-lighter" />
        <p className="ui-text-sm text-text">GitHub CLI not installed</p>
        <p className="ui-text-sm mt-1 text-text-lighter">
          Install it with <code className="rounded bg-hover px-1 py-0.5">{install.label}</code>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={install.action}
            variant="ghost"
            size="xs"
            className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
            aria-label="Open install instructions"
          >
            Install guide
          </Button>
          <span className="text-border">|</span>
          <Button
            onClick={() => void checkAuth()}
            variant="ghost"
            size="xs"
            className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
            aria-label="Retry"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4 text-center">
      <AlertCircle className="mb-2 text-text-lighter" />
      <p className="ui-text-sm text-text">GitHub CLI not authenticated</p>
      <p className="ui-text-sm mt-1 text-text-lighter">
        Run <code className="rounded bg-hover px-1 py-0.5">gh auth login</code> in terminal
      </p>
      <Button
        onClick={() => void checkAuth()}
        variant="ghost"
        size="xs"
        className="mt-2 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
        aria-label="Retry authentication check"
      >
        Retry
      </Button>
    </div>
  );
}
