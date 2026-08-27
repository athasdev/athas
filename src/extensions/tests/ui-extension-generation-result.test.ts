import { describe, expect, it } from "vite-plus/test";
import { parseUIExtensionGenerationResult } from "../ui/services/ui-extension-generation-result";

const code =
  'api.sidebar.registerView({ id: "health", title: "Health", render: () => api.ui.empty("Ready") });';

describe("UI extension generation result", () => {
  it("validates and normalizes a structured surface preview", () => {
    const result = parseUIExtensionGenerationResult({
      id: "release-health",
      name: "Release Health",
      description: "Tracks release readiness.",
      code,
      preview: {
        title: " Release health ",
        highlights: [" Checks ", 42, "Deployments", "History", "Ignored"],
        view: {
          type: "card",
          title: "Production",
          children: [
            { type: "progress", label: "Rollout", value: 140 },
            {
              type: "sparkline",
              label: "Deploy time",
              values: [52, 45, 39, 34],
              detail: "34s",
            },
            {
              type: "disclosure",
              title: "Release metadata",
              children: [
                {
                  type: "keyValue",
                  items: [{ label: "Commit", value: "8ad3f1", monospace: true }],
                },
              ],
            },
            {
              type: "activity",
              items: [
                { title: "Build", meta: "passed", state: "success" },
                { title: "Deploy", meta: "running", state: "running" },
              ],
            },
            {
              type: "diff",
              filePath: "src/release.ts",
              lines: [
                { type: "removed", content: "const ready = false;", oldLine: 4 },
                { type: "added", content: "const ready = true;", newLine: 4 },
              ],
            },
          ],
        },
      },
    });

    expect(result.preview?.title).toBe("Release health");
    expect(result.preview?.highlights).toEqual(["Checks", "Deployments", "History"]);
    expect(result.preview?.view).toMatchObject({
      type: "card",
      children: [
        { type: "progress", value: 100 },
        { type: "sparkline", values: [52, 45, 39, 34] },
        {
          type: "disclosure",
          children: [{ type: "keyValue", items: [{ value: "8ad3f1" }] }],
        },
        {
          type: "activity",
          items: [
            { title: "Build", state: "success" },
            { title: "Deploy", state: "running" },
          ],
        },
        {
          type: "diff",
          filePath: "src/release.ts",
          lines: [
            { type: "removed", oldLine: 4 },
            { type: "added", newLine: 4 },
          ],
        },
      ],
    });
  });

  it("rejects invalid preview nodes and executable source escapes", () => {
    expect(() =>
      parseUIExtensionGenerationResult({
        id: "broken",
        name: "Broken",
        description: "Broken preview.",
        code,
        preview: { view: { type: "iframe", src: "https://example.com" } },
      }),
    ).toThrow('unsupported node type "iframe"');

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "remote",
        name: "Remote",
        description: "Loads remote code.",
        code: 'import("https://example.com/extension.js")',
      }),
    ).toThrow("must not use imports");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "action-preview",
        name: "Action preview",
        description: "Contains an executable preview action.",
        code,
        preview: {
          view: {
            type: "activity",
            items: [
              {
                title: "Deploy",
                onSelect: { command: "athas.deploy.open" },
              },
            ],
          },
        },
      }),
    ).toThrow("preview must not include actions");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "control-preview",
        name: "Control preview",
        description: "Contains an interactive preview control.",
        code,
        preview: {
          view: {
            type: "numberInput",
            value: 3,
            disabled: true,
          },
        },
      }),
    ).toThrow("must not include interactive numberInput nodes");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "form-preview",
        name: "Form preview",
        description: "Contains an interactive preview form.",
        code,
        preview: {
          view: {
            type: "form",
            submitLabel: "Connect",
            onSubmit: { command: "athas.connect" },
            children: [{ type: "input", name: "token" }],
          },
        },
      }),
    ).toThrow("must not include interactive form nodes");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "tree-action-preview",
        name: "Tree action preview",
        description: "Contains a nested executable preview action.",
        code,
        preview: {
          view: {
            type: "tree",
            label: "Files",
            items: [
              {
                id: "src",
                title: "src",
                children: [
                  {
                    id: "src-main",
                    title: "main.ts",
                    onSelect: { command: "athas.workspace.open" },
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toThrow("preview must not include actions");
  });

  it("normalizes least-privilege host capabilities", () => {
    const result = parseUIExtensionGenerationResult({
      id: "workspace-health",
      name: "Workspace Health",
      description: "Reads workspace state and loads service health.",
      permissions: {
        workspace: "read",
        network: ["https://status.example.com/", "https://status.example.com"],
        clipboardWrite: true,
      },
      code: `
        api.commands.register({
          id: "refresh",
          title: "Refresh",
          async run() {
            await api.workspace.getCurrent();
            await api.http.request({ url: "https://status.example.com/health" });
            await api.clipboard.writeText("workspace ready");
          },
        });
      `,
    });

    expect(result.permissions).toEqual({
      workspace: "read",
      network: ["https://status.example.com"],
      clipboardWrite: true,
    });
  });

  it("rejects missing, unused, and wildcard permissions", () => {
    expect(() =>
      parseUIExtensionGenerationResult({
        id: "missing-permission",
        name: "Missing Permission",
        description: "Reads the workspace.",
        code: 'api.commands.register({ id: "read", title: "Read", run: () => api.workspace.getCurrent() });',
      }),
    ).toThrow("uses workspace read without requesting permission");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "unused-permission",
        name: "Unused Permission",
        description: "Requests unnecessary access.",
        permissions: { openExternal: true },
        code,
      }),
    ).toThrow("requests unused external links permission");

    expect(() =>
      parseUIExtensionGenerationResult({
        id: "wildcard-permission",
        name: "Wildcard Permission",
        description: "Requests broad network access.",
        permissions: { network: ["https://*"] },
        code: 'api.commands.register({ id: "load", title: "Load", run: () => api.http.request({ url: "https://example.com" }) });',
      }),
    ).toThrow("must be an exact origin");
  });
});
