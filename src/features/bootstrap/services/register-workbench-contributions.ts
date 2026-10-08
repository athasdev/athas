import { registerExtensionPaneViews } from "@/extensions/ui/services/extension-pane-views";
import { registerAiEditorFeatures } from "@/features/ai/services/ai-editor-features";
import { registerAiViews } from "@/features/ai/services/ai-views";
import { registerBrowserViews } from "@/features/browser/services/browser-views";
import { registerCollaborationViews } from "@/features/collaboration/services/collaboration-views";
import { registerDatabaseViews } from "@/features/database/services/database-views";
import { registerDiagnosticsViews } from "@/features/diagnostics/services/diagnostics-views";
import { registerDockerViews } from "@/features/docker/services/docker-views";
import { registerFileExplorerViews } from "@/features/file-explorer/services/file-explorer-views";
import { registerGitViews } from "@/features/git/services/git-views";
import { registerGitHubLinkedAccount } from "@/features/github/services/github-linked-account";
import { registerGitHubViews } from "@/features/github/services/github-views";
import { registerGlobalSearchViews } from "@/features/global-search/services/global-search-views";
import { registerOnboardingViews } from "@/features/onboarding/services/onboarding-views";
import { registerReferencesViews } from "@/features/references/services/references-views";
import { registerSettingsViews } from "@/features/settings/services/settings-views";
import { registerTerminalViews } from "@/features/terminal/services/terminal-views";
import { registerViewerViews } from "@/features/viewer/services/viewer-views";
import { registerCustomViews } from "@/features/views/services/views-views";
import { registerWorkspaceViews } from "@/features/workspace/team/services/workspace-views";

let registered = false;

/**
 * Registers what each feature contributes to the workbench: the views of its buffers and sidebar
 * panels, tab decorations, code editor features, and linked accounts. The workbench entry runs this at module scope, before its first render. The pane views
 * that register a prefetch load in this order once the workbench is idle.
 */
export function registerWorkbenchContributions() {
  if (registered) return;
  registered = true;

  registerTerminalViews();
  registerGitViews();
  registerGlobalSearchViews();
  registerAiViews();
  registerSettingsViews();
  registerGitHubViews();
  registerBrowserViews();
  registerDatabaseViews();
  registerDiagnosticsViews();
  registerReferencesViews();
  registerOnboardingViews();
  registerViewerViews();
  registerCustomViews();
  registerWorkspaceViews();
  registerExtensionPaneViews();
  registerFileExplorerViews();
  registerDockerViews();
  registerCollaborationViews();
  registerAiEditorFeatures();
  registerGitHubLinkedAccount();
}
