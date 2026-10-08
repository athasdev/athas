import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { registerTabDecoration } from "@/features/tabs/services/tab-decoration-registry";
import { AgentTabAttention, AgentTabIcon } from "../components/agent-tab-decorations";
import { NewTabView } from "../components/new-tab-view";

const loadAgentTab = () => import("../components/agent-tab");
const AgentTab = lazy(() => loadAgentTab().then((module) => ({ default: module.AgentTab })));
const ContinuousAgentsResource = lazy(() => import("../continuous-agents/resource"));
const AcpInspectorView = lazy(() => import("../acp-inspector/components/acp-inspector-view"));
const AgentEditsReviewView = lazy(() => import("../components/chat/agent-edits-review"));
// Loaded on demand so the layout does not pull the AI stores into its import graph.
const AgentContextSidebar = lazy(() =>
  import("../components/panel/agent-context-sidebar").then((module) => ({
    default: module.AgentContextSidebar,
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
    getProps: (buffer, host) => ({ buffer, isActive: host.isActive }),
    prefetch: loadAgentTab,
  });
  registerTabDecoration("agent", { icon: AgentTabIcon, indicator: AgentTabAttention });
  registerPaneView("continuousAgents", {
    component: ContinuousAgentsResource,
    getProps: () => ({}),
  });
  registerPaneView("acpInspector", { component: AcpInspectorView, getProps: () => ({}) });
  registerPaneView("agentChanges", { component: AgentEditsReviewView, getProps: () => ({}) });

  registerSidebarView({
    id: "agents",
    order: 80,
    component: AgentsSidebar,
    isAvailable: ({ coreFeatures }) => coreFeatures.aiChat,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
  registerSidebarView({
    id: "agent",
    order: 90,
    component: AgentContextSidebar,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
}
