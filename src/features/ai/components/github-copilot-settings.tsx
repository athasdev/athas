import { AlertCircle, Zap } from "lucide-react";
import { useUIState } from "@/stores/ui-state-store";
import Button from "@/ui/button";

const GitHubCopilotSettings = () => {
  // Get data from stores
  const { isGitHubCopilotSettingsVisible, setIsGitHubCopilotSettingsVisible } = useUIState();

  const isVisible = isGitHubCopilotSettingsVisible;
  const onClose = () => setIsGitHubCopilotSettingsVisible(false);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="pointer-events-auto mx-4 w-full max-w-md rounded-lg border border-border bg-primary-bg shadow-2xl"
        style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-border border-b px-4 py-3">
          <Zap size={16} className="text-text" />
          <h2 className="ui-font font-medium text-sm text-text">GitHub Copilot Integration</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            GitHub Copilot integration uses official GitHub authentication through the code Editor.
          </div>

          {/* Coming Soon Notice */}
          <div className="space-y-3 rounded border border-border bg-secondary-bg p-4">
            <div className="flex items-center gap-2 font-medium text-sm text-text">
              <AlertCircle size={14} className="text-blue-400" />
              <span>Coming Soon</span>
            </div>
            <div className="text-text-lighter text-xs leading-relaxed">
              GitHub Copilot integration is currently in development. GitHub Copilot does not
              support API key authentication. It requires OAuth-based authentication through
              official GitHub channels.
            </div>
          </div>

          {/* Information */}
          <div className="space-y-2 rounded border border-border bg-secondary-bg p-3">
            <div className="mb-2 font-medium text-text text-xs">
              How GitHub Copilot authentication works:
            </div>
            <ul className="list-inside list-disc space-y-1 text-text-lighter text-xs">
              <li>Requires a GitHub Copilot subscription</li>
              <li>Uses OAuth authentication with GitHub</li>
              <li>Integrates through official IDE extensions</li>
              <li>Does not support standalone API keys</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button onClick={onClose} variant="default" className="flex-1">
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitHubCopilotSettings;
