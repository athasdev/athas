import { type ComponentType, createElement, lazy } from "react";
import {
  type DockPaneProps,
  registerDockPane,
  registerDockSessionInfo,
} from "@/features/layout/services/dock-pane-registry";
import { GitDiffIcon, GlobeIcon, ListChecksIcon, TerminalIcon } from "@/ui/icons";
import {
  useHasSessionPlan,
  useIsLocalSession,
  useIsLocalSessionInMainWindow,
} from "../session-panel/hooks/use-session-tool-availability";
import { useSessionHasInfo } from "../session-panel/hooks/use-session-boxes";
import {
  registerEmptyPaneView,
  registerPaneView,
} from "@/features/panes/services/pane-view-registry";
import { registerDiffBanner } from "@/features/git/services/diff-banner-registry";
import { registerTabDecoration } from "@/features/tabs/services/tab-decoration-registry";
import { AgentTabAttention, AgentTabIcon } from "../components/agent-tab-decorations";
import { CLAUDE_CODE_PROPOSAL } from "../integrations/claude-code/services/claude-diff-proposal";

const loadAgentTab = () => import("../components/agent-tab");
const AgentHeaderActions = lazy(() =>
  import("../components/agent-header-actions").then((module) => ({
    default: module.AgentHeaderActions,
  })),
);
const AgentTab = lazy(() => loadAgentTab().then((module) => ({ default: module.AgentTab })));
const ProjectDashboardView = lazy(() =>
  import("../project-dashboard/components/project-dashboard-view").then((module) => ({
    default: module.ProjectDashboardView,
  })),
);
const EmbeddedNewSession = lazy(() =>
  import("../components/embedded-new-session").then((module) => ({
    default: module.EmbeddedNewSession,
  })),
);
const ContinuousAgentsResource = lazy(() => import("../continuous-agents/resource"));
const AcpInspectorView = lazy(() => import("../acp-inspector/components/acp-inspector-view"));
const CustomizeView = lazy(() => import("../customize/components/customize-view"));
const AgentEditsReviewView = lazy(() => import("../components/chat/agent-edits-review"));
const ClaudeDiffReviewBar = lazy(() =>
  import("../integrations/claude-code/components/claude-diff-review-bar").then((module) => ({
    default: module.ClaudeDiffReviewBar,
  })),
);

const loadDockPanes = () => import("../session-panel/components/session-dock-panes");
const fromDockPanes = <K extends keyof Awaited<ReturnType<typeof loadDockPanes>>>(name: K) =>
  lazy(() =>
    loadDockPanes().then((module) => ({
      default: module[name] as ComponentType<DockPaneProps>,
    })),
  );
const loadDockInfo = () => import("../session-panel/components/session-dock-info");
const SessionInfoColumn = lazy(() =>
  loadDockInfo().then((module) => ({ default: module.SessionInfoColumn })),
);
const SessionInfoSummary = lazy(() =>
  loadDockInfo().then((module) => ({ default: module.SessionInfoSummary })),
);

/**
 * The session's tools for the dock. A detached agent window registers them too, for its own dock;
 * the terminal and browser stay with the main window, which hosts the terminals and webviews.
 */
export function registerSessionDockPanes() {
  registerDockPane({
    id: "changes",
    title: "Changes",
    icon: createElement(GitDiffIcon),
    order: 10,
    scope: "session",
    component: fromDockPanes("SessionChangesPane"),
    HeaderDetail: fromDockPanes("SessionChangesDetail"),
    HeaderActions: fromDockPanes("SessionChangesActions"),
    useAvailable: useIsLocalSession,
  });
  registerDockPane({
    id: "terminal",
    title: "Terminal",
    icon: createElement(TerminalIcon),
    order: 20,
    scope: "session",
    component: fromDockPanes("SessionTerminalPane"),
    HeaderActions: fromDockPanes("SessionTerminalActions"),
    useAvailable: useIsLocalSessionInMainWindow,
  });
  registerDockPane({
    id: "browser",
    title: "Browser",
    icon: createElement(GlobeIcon),
    order: 30,
    scope: "session",
    component: fromDockPanes("SessionBrowserPane"),
    HeaderActions: fromDockPanes("SessionBrowserActions"),
    useAvailable: useIsLocalSessionInMainWindow,
  });
  registerDockPane({
    id: "plan",
    title: "Plan",
    icon: createElement(ListChecksIcon),
    order: 40,
    scope: "session",
    component: fromDockPanes("SessionPlanPane"),
    HeaderDetail: fromDockPanes("SessionPlanDetail"),
    useAvailable: useHasSessionPlan,
  });
  registerDockSessionInfo({
    Column: SessionInfoColumn,
    Summary: SessionInfoSummary,
    useHasContent: useSessionHasInfo,
  });
}

export function registerAiViews() {
  registerSessionDockPanes();
  registerEmptyPaneView(EmbeddedNewSession);
  registerPaneView("projectDashboard", {
    component: ProjectDashboardView,
    getProps: (buffer) => ({ projectPath: buffer.projectPath }),
    keyByBuffer: true,
  });
  registerPaneView("agent", {
    component: AgentTab,
    getProps: (buffer, host) => ({ buffer, isActive: host.isActive }),
    prefetch: loadAgentTab,
    headerActions: AgentHeaderActions,
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
  registerPaneView("acpInspector", { component: AcpInspectorView, getProps: () => ({}) });
  registerPaneView("agentChanges", { component: AgentEditsReviewView, getProps: () => ({}) });
  registerPaneView("customize", { component: CustomizeView, getProps: () => ({}) });
  registerDiffBanner(CLAUDE_CODE_PROPOSAL, ClaudeDiffReviewBar);
}
