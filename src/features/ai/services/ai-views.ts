import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { registerDiffBanner } from "@/features/git/services/diff-banner-registry";
import { registerTabDecoration } from "@/features/tabs/services/tab-decoration-registry";
import { AgentTabAttention, AgentTabIcon } from "../components/agent-tab-decorations";
import { NewTabView } from "../components/new-tab-view";
import { CLAUDE_CODE_PROPOSAL } from "../integrations/claude-code/services/claude-diff-proposal";

const loadAgentTab = () => import("../components/agent-tab");
const AgentTab = lazy(() => loadAgentTab().then((module) => ({ default: module.AgentTab })));
const ContinuousAgentsResource = lazy(() => import("../continuous-agents/resource"));
const CloudAgentsResource = lazy(() => import("../cloud-agents/resource"));
const AcpInspectorView = lazy(() => import("../acp-inspector/components/acp-inspector-view"));
const AgentEditsReviewView = lazy(() => import("../components/chat/agent-edits-review"));
const ClaudeDiffReviewBar = lazy(() =>
  import("../integrations/claude-code/components/claude-diff-review-bar").then((module) => ({
    default: module.ClaudeDiffReviewBar,
  })),
);
const AgentsSidebar = lazy(() =>
  import("../components/sidebar/agents-sidebar").then((module) => ({
    default: module.AgentsSidebar,
  })),
);

export function registerAiViews() {
  registerPaneView("newTab", {
    component: NewTabView,
    getProps: (buffer, host) => ({ autoFocus: host.isActive, surfaceId: `new-tab-${buffer.id}` }),
  });
  registerPaneView("agent", {
    component: AgentTab,
    getProps: (buffer, host) => ({ buffer, paneId: host.paneId, isActive: host.isActive }),
    prefetch: loadAgentTab,
    onClose: (buffer) => {
      void import("../session-panel/services/session-panel-resources").then(
        ({ releaseSessionPanelResources }) => releaseSessionPanelResources(buffer.sessionId),
      );
    },
  });
  registerTabDecoration("agent", { icon: AgentTabIcon, indicator: AgentTabAttention });
  registerPaneView("continuousAgents", {
    component: ContinuousAgentsResource,
    getProps: () => ({}),
  });
  registerPaneView("cloudAgents", { component: CloudAgentsResource, getProps: () => ({}) });
  registerPaneView("acpInspector", { component: AcpInspectorView, getProps: () => ({}) });
  registerPaneView("agentChanges", { component: AgentEditsReviewView, getProps: () => ({}) });
  registerDiffBanner(CLAUDE_CODE_PROPOSAL, ClaudeDiffReviewBar);

  registerSidebarView({
    id: "agents",
    order: 80,
    component: AgentsSidebar,
    isAvailable: ({ coreFeatures }) => coreFeatures.aiChat,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
}
