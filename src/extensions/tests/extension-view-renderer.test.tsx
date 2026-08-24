import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ExtensionViewRenderer } from "../ui/components/extension-view-renderer";
import type { ExtensionViewNode } from "../ui/types/extension-view";

describe("ExtensionViewRenderer", () => {
  it("renders composable data and status nodes with Athas primitives", () => {
    const node: ExtensionViewNode = {
      type: "stack",
      children: [
        {
          type: "card",
          title: "Deploy health",
          description: "Current production state",
          variant: "muted",
          children: [{ type: "text", value: "All systems operational", tone: "success" }],
        },
        {
          type: "row",
          children: [
            { type: "metric", label: "Passing", value: 18, detail: "+2", tone: "success" },
            { type: "metric", label: "Failing", value: 1, tone: "error" },
          ],
        },
        { type: "progress", label: "Coverage", value: 82.4 },
        {
          type: "sparkline",
          label: "Build duration",
          values: [42, 38, 35, 31],
          detail: "31s",
          tone: "success",
        },
        {
          type: "barChart",
          label: "Check outcomes",
          items: [
            { label: "Passed", value: 18, tone: "success" },
            { label: "Failed", value: 1, tone: "error" },
          ],
        },
        {
          type: "callout",
          title: "One check needs attention",
          description: "Open the failing check for details.",
          tone: "warning",
        },
        {
          type: "table",
          columns: ["Check", "State"],
          rows: [
            ["Typecheck", "Passed"],
            ["Linux ARM64", "Failed"],
          ],
          caption: "Latest run",
        },
        { type: "code", value: "bun check", language: "shell" },
        {
          type: "diff",
          filePath: "src/main.ts",
          oldPath: "src/bootstrap.ts",
          language: "typescript",
          lines: [
            { type: "header", content: "-4,2 +4,2" },
            { type: "removed", content: "const ready = false;", oldLine: 4 },
            { type: "added", content: "const ready = true;", newLine: 4 },
          ],
          truncated: true,
        },
        {
          type: "activity",
          items: [
            {
              title: "Build Linux ARM64",
              description: "Compiling release bundle",
              meta: "running",
              state: "running",
            },
            { title: "Typecheck", meta: "passed", state: "success" },
          ],
        },
        {
          type: "button",
          label: "Deploy",
          pendingLabel: "Deploying",
          action: { command: "athas.release.deploy" },
          tone: "accent",
        },
        {
          type: "input",
          label: "Release note",
          placeholder: "Describe this release",
          onSubmit: { command: "athas.release.note" },
        },
        {
          type: "textarea",
          label: "Deployment summary",
          placeholder: "Summarize the rollout",
          rows: 5,
          onSubmit: { command: "athas.release.summary" },
        },
        {
          type: "numberInput",
          label: "Replica count",
          value: 3,
          min: 1,
          max: 10,
          onChange: { command: "athas.release.replicas" },
        },
        {
          type: "select",
          label: "Environment",
          value: "production",
          options: [
            { label: "Production", value: "production" },
            { label: "Staging", value: "staging" },
          ],
          onChange: { command: "athas.environment.change" },
        },
        {
          type: "toggle",
          label: "Auto deploy",
          description: "Deploy after checks pass",
          checked: true,
          onChange: { command: "athas.autoDeploy.change" },
        },
        {
          type: "checkbox",
          label: "Include migration notes",
          description: "Attach migration details to the release.",
          checked: true,
          onChange: { command: "athas.release.includeMigrations" },
        },
        {
          type: "choice",
          label: "Environment type",
          description: "Choose where the release will run.",
          value: "production",
          options: [
            { label: "Production", value: "production" },
            { label: "Preview", value: "preview" },
          ],
          onChange: { command: "athas.release.environmentType" },
        },
        {
          type: "tabs",
          value: "summary",
          tabs: [
            {
              value: "summary",
              label: "Summary",
              children: [{ type: "text", value: "Release is ready" }],
            },
            {
              value: "logs",
              label: "Logs",
              children: [{ type: "code", value: "Build passed" }],
            },
          ],
        },
        {
          type: "disclosure",
          title: "Build details",
          description: "Expanded diagnostic output",
          open: true,
          children: [{ type: "code", value: "Build passed" }],
        },
        {
          type: "keyValue",
          items: [
            { label: "Commit", value: "8ad3f1", monospace: true },
            { label: "Duration", value: 42, tone: "success" },
          ],
        },
        {
          type: "tree",
          label: "Workspace dependencies",
          items: [
            {
              id: "src",
              title: "src",
              icon: "folder",
              expanded: true,
              children: [
                {
                  id: "src-main",
                  title: "main.ts",
                  description: "src/main.ts",
                  meta: "line 42",
                  icon: "file-text",
                  badges: [{ label: "Changed", tone: "warning" }],
                  onSelect: { command: "athas.workspace.open", args: ["src/main.ts"] },
                },
              ],
            },
          ],
        },
        {
          type: "form",
          submitLabel: "Create release",
          pendingLabel: "Creating release",
          onSubmit: { command: "athas.release.create" },
          children: [
            {
              type: "input",
              name: "releaseName",
              required: true,
              label: "Release name",
              value: "Athas 1.0",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<ExtensionViewRenderer node={node} execute={vi.fn()} />);

    expect(markup).toContain("Deploy health");
    expect(markup).toContain("Passing");
    expect(markup).toContain("82%");
    expect(markup).toContain('data-slot="sparkline"');
    expect(markup).toContain(
      'aria-label="Build duration: 4 points, minimum 31, maximum 42, latest 31"',
    );
    expect(markup).toContain('data-slot="extension-view-bar-chart"');
    expect(markup).toContain("Check outcomes");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-destructive");
    expect(markup).toContain('data-slot="alert"');
    expect(markup).toContain('data-slot="table"');
    expect(markup).toContain("Linux ARM64");
    expect(markup).toContain('data-language="shell"');
    expect(markup).toContain("bun check");
    expect(markup).toContain('data-slot="diff-preview"');
    expect(markup).toContain("src/main.ts");
    expect(markup).toContain("from src/bootstrap.ts");
    expect(markup).toContain("const ready = false;");
    expect(markup).toContain("const ready = true;");
    expect(markup).toContain("Diff preview truncated");
    expect(markup).toContain("text-git-added");
    expect(markup).toContain("text-git-deleted");
    expect(markup).toContain("Build Linux ARM64");
    expect(markup).toContain("Compiling release bundle");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Deploy");
    expect(markup).toContain('data-variant="accent"');
    expect(markup).toContain("Release note");
    expect(markup).toContain("Describe this release");
    expect(markup).toContain("Deployment summary");
    expect(markup).toContain("Summarize the rollout");
    expect(markup).toContain("Replica count");
    expect(markup).toContain('aria-label="Replica count"');
    expect(markup).toContain('type="number" min="1" max="10"');
    expect(markup).toContain("Environment");
    expect(markup).toContain("Production");
    expect(markup).toContain("Auto deploy");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain("Include migration notes");
    expect(markup).toContain('data-slot="checkbox"');
    expect(markup).toContain("Environment type");
    expect(markup).toContain("Choose where the release will run.");
    expect(markup).toContain('data-slot="toggle-group"');
    expect(markup).toContain('data-slot="tabs"');
    expect(markup).toContain("Summary");
    expect(markup).toContain("Release is ready");
    expect(markup).toContain('data-slot="accordion"');
    expect(markup).toContain("Build details");
    expect(markup).toContain("Expanded diagnostic output");
    expect(markup).toContain("Commit");
    expect(markup).toContain("8ad3f1");
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="Workspace dependencies"');
    expect(markup).toContain('role="treeitem"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("main.ts");
    expect(markup).toContain("line 42");
    expect(markup).toContain("Changed");
    expect(markup).toContain('data-slot="extension-view-form"');
    expect(markup).toContain('name="releaseName"');
    expect(markup).toContain("Create release");
  });

  it("clamps progress values to the supported percentage range", () => {
    const markup = renderToStaticMarkup(
      <ExtensionViewRenderer
        node={{ type: "progress", label: "Sync", value: 140 }}
        execute={vi.fn()}
      />,
    );

    expect(markup).toContain("100%");
    expect(markup).toContain('aria-valuenow="100"');
  });

  it("renders screens without sidebar chrome on embedded surfaces", () => {
    const markup = renderToStaticMarkup(
      <ExtensionViewRenderer
        surface="embedded"
        node={{
          type: "screen",
          title: "Inline status",
          children: [
            {
              type: "list",
              children: [{ type: "listItem", title: "API", description: "Healthy" }],
            },
          ],
        }}
        execute={vi.fn()}
      />,
    );

    expect(markup).toContain('data-slot="extension-view-screen"');
    expect(markup).toContain("Inline status");
    expect(markup).toContain('data-slot="item"');
    expect(markup).not.toContain('data-slot="scroll-area"');
  });
});
