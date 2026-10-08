import { describe, expect, it } from "vite-plus/test";
import { getSidebarViews } from "@/features/layout/services/sidebar-view-registry";
import { getPaneView } from "@/features/panes/services/pane-view-registry";
import type { PaneContentType } from "@/features/panes/types/pane-content.types";
import { getTabDecoration } from "@/features/tabs/services/tab-decoration-registry";
import { registerWorkbenchContributions } from "../services/register-workbench-contributions";

registerWorkbenchContributions();

// Text buffers render in the code editor, which the pane container owns.
const TEXT_TYPES = new Set<PaneContentType>([
  "editor",
  "markdownPreview",
  "htmlPreview",
  "csvPreview",
  "svgPreview",
]);

const VIEW_TYPES: PaneContentType[] = [
  "terminal",
  "browser",
  "agent",
  "newTab",
  "diff",
  "image",
  "pdf",
  "binary",
  "database",
  "pullRequest",
  "githubIssue",
  "githubDelivery",
  "githubAction",
  "githubForm",
  "customView",
  "markdownDocument",
  "externalEditor",
  "globalSearch",
  "diagnostics",
  "references",
  "continuousAgents",
  "acpInspector",
  "agentChanges",
  "workspaces",
  "settings",
  "extensions",
  "extension",
  "onboarding",
];

describe("workbench contributions", () => {
  it("registers a view for every buffer type that is not text", () => {
    for (const type of VIEW_TYPES) {
      expect(TEXT_TYPES.has(type)).toBe(false);
      expect(getPaneView(type), type).toBeDefined();
    }
    for (const type of TEXT_TYPES) expect(getPaneView(type), type).toBeUndefined();
  });

  it("keeps the sidebar views in their order", () => {
    expect(getSidebarViews().map((view) => view.id)).toEqual([
      "git",
      "github-prs",
      "views",
      "docker",
      "workspaces",
      "databases",
      "files",
      "agents",
      "agent",
      "collaboration",
    ]);
  });

  it("marks the GitHub buffers as resources and decorates agent tabs", () => {
    for (const type of [
      "pullRequest",
      "githubIssue",
      "githubDelivery",
      "githubAction",
      "githubForm",
    ] as const) {
      expect(getPaneView(type)?.resource, type).toBeDefined();
    }
    expect(getPaneView("terminal")?.resource).toBeUndefined();
    expect(getTabDecoration("agent")?.icon).toBeDefined();
    expect(getTabDecoration("agent")?.indicator).toBeDefined();
  });
});
