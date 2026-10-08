import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  policy: vi.fn<(root: string) => Promise<(path: string) => boolean>>(async () => () => true),
  root: null as string | null,
  enabled: true,
  diagnostics: new Map<string, unknown[]>(),
}));

vi.mock("@/features/ai/services/agent-context-policy", () => ({
  loadAgentContextPolicy: mocks.policy,
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: mocks.root }), subscribe: () => () => {} },
}));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => {
  class InlineEditError extends Error {
    hosted: boolean;
    constructor(
      message: string,
      public status: number,
      options?: { hosted?: boolean },
    ) {
      super(message);
      this.hosted = options?.hosted ?? false;
    }
  }
  return { requestInlineEdit: mocks.request, InlineEditError };
});
vi.mock("@/features/ai/intelligence/services/intelligence-connection", () => ({
  AutocompleteModelRequiredError: class extends Error {},
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { aiCompletion: mocks.enabled } }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/features/diagnostics/stores/diagnostics.store", () => ({
  useDiagnosticsStore: { getState: () => ({ diagnosticsByFile: mocks.diagnostics }) },
}));
vi.mock("@/features/ai/services/ai-token-service", () => ({ onProviderApiTokenChange: vi.fn() }));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({ useAIChatStore: { subscribe: vi.fn() } }));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true }), subscribe: () => () => {} },
}));
vi.mock("@/features/ai/intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { subscribe: () => () => {} },
}));

import { InlineEditError } from "@/features/ai/intelligence/services/intelligence-text-service";
import {
  clearRecentEdits,
  getNearbyDiagnostics,
  getRecentEdits,
  getRelatedFileSnippets,
  recordRecentEdit,
  summarizeRelatedFile,
} from "../intelligence-completion/intelligence-completion-context";
import {
  requestIntelligenceCompletion,
  trimSuffixOverlap,
} from "../intelligence-completion/intelligence-completion-service";
import { useIntelligenceCompletionStore } from "../stores/intelligence-completion.store";

function lines(...text: string[]) {
  return { lineCount: text.length, lineText: (line: number) => text[line - 1] };
}

function completionRequest(
  overrides: Partial<Parameters<typeof requestIntelligenceCompletion>[0]> = {},
) {
  return {
    filePath: "/project/a.ts",
    languageId: "typescript",
    beforeSelection: "const value = ",
    afterSelection: ";",
    line: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.enabled = true;
  mocks.root = null;
  mocks.diagnostics = new Map();
  clearRecentEdits();
  useIntelligenceCompletionStore.getState().actions.resume();
});

describe("intelligence completion context", () => {
  it("records recent edits with surrounding lines and skips the edit at the cursor", () => {
    recordRecentEdit("/project/a.ts", lines("one", "two", "three", "four"), 2, "x");
    recordRecentEdit("/project/b.ts", lines("alpha", "beta"), 1, "y\nz");
    expect(getRecentEdits("/project/a.ts", 2)).toEqual([
      { filePath: "/project/b.ts", snippet: "alpha\nbeta" },
    ]);
    expect(getRecentEdits("/project/a.ts", 20)).toEqual([
      { filePath: "/project/a.ts", snippet: "one\ntwo\nthree" },
      { filePath: "/project/b.ts", snippet: "alpha\nbeta" },
    ]);
  });

  it("never records sensitive files", () => {
    recordRecentEdit("/project/.env", lines("SECRET=1"), 1, "1");
    expect(getRecentEdits("/other", 1)).toEqual([]);
  });

  it("keeps nearby errors and warnings, closest first", () => {
    expect(
      getNearbyDiagnostics(
        [
          { severity: "info", message: "info", line: 0 },
          { severity: "warning", message: "warn", line: 4 },
          { severity: "error", message: "err", line: 1 },
          { severity: "error", message: "far", line: 90 },
        ],
        2,
      ),
    ).toEqual([
      { line: 2, severity: "error", message: "err" },
      { line: 5, severity: "warning", message: "warn" },
    ]);
  });
});

describe("related file context", () => {
  const files = [
    { path: "/p/src/b.ts", content: "export const b = 1;", languageId: "typescript" },
    {
      path: "/p/src/math.ts",
      content: "// helpers\nexport function add(a: number, b: number) {\n  return a + b;\n}",
      languageId: "typescript",
    },
    { path: "/p/src/ui/index.ts", content: "export { Button } from './button';" },
    { path: "/p/.env", content: "SECRET=1", languageId: "dotenv" },
    { path: "/p/src/a.ts", content: "import { add } from './math';", languageId: "typescript" },
  ];

  it("puts the files the code imports first, then same-language files", () => {
    const related = getRelatedFileSnippets(
      "/p/src/a.ts",
      "typescript",
      "import { add } from './math';\nimport { Button } from './ui';\nadd(",
      files,
    );
    expect(related.map((file) => file.filePath)).toEqual([
      "/p/src/math.ts",
      "/p/src/ui/index.ts",
      "/p/src/b.ts",
    ]);
    expect(related[0]?.snippet).toBe("export function add(a: number, b: number) {");
  });

  it("never sends sensitive files or the file itself", () => {
    const related = getRelatedFileSnippets(
      "/p/src/a.ts",
      "dotenv",
      "import x from '../.env'",
      files,
    );
    expect(related.map((file) => file.filePath)).not.toContain("/p/.env");
    expect(related.map((file) => file.filePath)).not.toContain("/p/src/a.ts");
  });

  it("follows Python module imports", () => {
    const related = getRelatedFileSnippets("/p/app.py", "python", "from pkg.models import User\n", [
      { path: "/p/pkg/models.py", content: "class User:\n    name: str", languageId: "python" },
    ]);
    expect(related).toEqual([{ filePath: "/p/pkg/models.py", snippet: "class User:" }]);
  });

  it("falls back to a file's opening lines when it has no declarations", () => {
    expect(summarizeRelatedFile("a = 1\n\nb = 2")).toBe("a = 1\nb = 2");
  });
});

describe("intelligence completion requests", () => {
  it("trims a repeated suffix from multi-line completions", () => {
    expect(trimSuffixOverlap("a();\n}", "}\n")).toBe("a();\n");
    expect(trimSuffixOverlap("a()", "}")).toBe("a()");
  });

  it("sends the context and returns the completion", async () => {
    mocks.diagnostics = new Map([
      ["/project/a.ts", [{ severity: "error", message: "Missing value", line: 0 }]],
    ]);
    mocks.request.mockResolvedValue({ editedText: "42" });
    await expect(requestIntelligenceCompletion(completionRequest())).resolves.toBe("42");
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      feature: "autocomplete",
      beforeSelection: "const value = ",
      afterSelection: ";",
      filePath: "/project/a.ts",
      languageId: "typescript",
      diagnostics: [{ line: 1, severity: "error", message: "Missing value" }],
    });
    expect(useIntelligenceCompletionStore.getState().pending).toBe(0);
  });

  it("skips disabled, sensitive and policy-excluded files", async () => {
    mocks.enabled = false;
    await expect(requestIntelligenceCompletion(completionRequest())).resolves.toBeNull();
    mocks.enabled = true;
    await expect(
      requestIntelligenceCompletion(completionRequest({ filePath: "/project/key.pem" })),
    ).resolves.toBeNull();
    mocks.root = "/project";
    mocks.policy.mockResolvedValueOnce(() => false);
    await expect(requestIntelligenceCompletion(completionRequest())).resolves.toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("drops completions that only repeat the following text", async () => {
    mocks.request.mockResolvedValue({ editedText: ";" });
    await expect(requestIntelligenceCompletion(completionRequest())).resolves.toBeNull();
  });

  it("pauses on billing errors and stays quiet when aborted", async () => {
    mocks.request.mockRejectedValueOnce(new InlineEditError("No credit", 402, { hosted: true }));
    await requestIntelligenceCompletion(completionRequest());
    expect(useIntelligenceCompletionStore.getState().status).toMatchObject({
      kind: "paused",
      reason: "credits",
    });

    useIntelligenceCompletionStore.getState().actions.resume();
    const controller = new AbortController();
    mocks.request.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await requestIntelligenceCompletion(completionRequest({ signal: controller.signal }));
    expect(useIntelligenceCompletionStore.getState().status.kind).toBe("idle");
  });

  it("reports a provider's own error message instead of a generic failure", async () => {
    const apiError = Object.assign(new Error("model `gpt-x` does not exist\nrequest id: 1"), {
      statusCode: 404,
    });
    mocks.request.mockRejectedValueOnce(apiError);
    await requestIntelligenceCompletion(completionRequest());
    expect(useIntelligenceCompletionStore.getState().status).toMatchObject({
      kind: "error",
      message: "model `gpt-x` does not exist",
    });

    useIntelligenceCompletionStore.getState().actions.resume();
    mocks.request.mockRejectedValueOnce("url not allowed on the configured scope");
    await requestIntelligenceCompletion(completionRequest());
    expect(useIntelligenceCompletionStore.getState().status).toMatchObject({
      kind: "error",
      message: "url not allowed on the configured scope",
    });
  });

  it("pauses on a provider's authentication error", async () => {
    mocks.request.mockRejectedValueOnce(
      Object.assign(new Error("Incorrect API key provided"), { statusCode: 401 }),
    );
    await requestIntelligenceCompletion(completionRequest());
    expect(useIntelligenceCompletionStore.getState().status).toMatchObject({
      kind: "paused",
      reason: "api-key",
      message: "Incorrect API key provided",
    });
  });
});
