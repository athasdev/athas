import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Monaco from "monaco-editor";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  editors: vi.fn(),
  markers: vi.fn(() => [] as unknown[]),
  enabled: true,
  authenticated: true,
  listeners: new Set<(...args: any[]) => void>(),
}));
vi.mock("monaco-editor", () => ({
  editor: {
    getEditors: mocks.editors,
    getModelMarkers: mocks.markers,
    EditorOption: { readOnly: 1 },
  },
  languages: {},
  Range: { fromPositions: (start: unknown, end = start) => ({ start, end }) },
}));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => {
  class InlineEditError extends Error {
    constructor(
      message: string,
      public status: number,
      options?: { hosted?: boolean },
    ) {
      super(message);
      this.hosted = options?.hosted ?? false;
    }
    hosted: boolean;
  }
  return { requestInlineEdit: mocks.request, InlineEditError };
});
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { aiCompletion: mocks.enabled } }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({ isAuthenticated: mocks.authenticated }),
    subscribe: (listener: (...args: any[]) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  },
}));
vi.mock("@/features/ai/intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { subscribe: () => () => {} },
}));

import { toast } from "sonner";
import { InlineEditError } from "@/features/ai/intelligence/services/intelligence-text-service";
import {
  createIntelligenceCompletionsProvider,
  trimSuffixOverlap,
} from "../engines/monaco/intelligence-completions";
import {
  clearRecentEdits,
  getNearbyDiagnostics,
  getRecentEdits,
  recordRecentEdit,
} from "../engines/monaco/intelligence-completion-context";
import { useIntelligenceCompletionStore } from "../stores/intelligence-completion.store";

function setup(path = "/project/file.ts") {
  let change = () => {};
  let version = 1;
  const dispose = vi.fn();
  const model = {
    uri: { scheme: "athas", authority: "editor", path, query: "buffer=1" },
    getOffsetAt: () => 20000,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getValueInRange: vi.fn().mockReturnValueOnce("const value = ").mockReturnValueOnce(";"),
    getVersionId: () => version,
    getLanguageId: () => "typescript",
    isDisposed: () => false,
    onDidChangeContent: (listener: () => void) => {
      change = listener;
      return { dispose };
    },
    onWillDispose: () => ({ dispose }),
  };
  mocks.editors.mockReturnValue([
    { getModel: () => model, hasTextFocus: () => true, getOption: () => false },
  ]);
  const provider = createIntelligenceCompletionsProvider();
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose }) };
  const run = () =>
    provider.provideInlineCompletions(
      model as unknown as Monaco.editor.ITextModel,
      { lineNumber: 1, column: 20001 } as Monaco.Position,
      {} as Monaco.languages.InlineCompletionContext,
      token as Monaco.CancellationToken,
    );
  return {
    run,
    model,
    dispose,
    edit: () => {
      version++;
      change();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.authenticated = true;
  mocks.markers.mockReturnValue([]);
  mocks.listeners.clear();
  clearRecentEdits();
  useIntelligenceCompletionStore.getState().actions.resume();
});

const status = () => useIntelligenceCompletionStore.getState().status;

describe("Intelligence editor completions", () => {
  it("requests bounded cursor context and preserves insertion whitespace", async () => {
    mocks.request.mockResolvedValue({ editedText: "  compute()" });
    const state = setup();
    const result = await state.run();
    expect(result?.items[0].insertText).toBe("  compute()");
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "autocomplete",
        beforeSelection: "const value = ",
        afterSelection: ";",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(state.model.getValueInRange.mock.calls[0][0].start.column).toBe(8001);
    expect(state.model.getValueInRange.mock.calls[1][0].end.column).toBe(24001);
    expect(state.dispose).toHaveBeenCalledTimes(3);
    expect(mocks.listeners.size).toBe(0);
  });

  it.each(["/project/.env", "/project/.env.local", "/project/private.pem"])(
    "skips sensitive file %s",
    async (path) => {
      expect(await setup(path).run()).toEqual({ items: [] });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("does not request completions when disabled or read-only", async () => {
    const state = setup();
    mocks.enabled = false;
    await state.run();
    mocks.enabled = true;
    mocks.editors.mockReturnValue([
      { getModel: () => state.model, hasTextFocus: () => true, getOption: () => true },
    ]);
    await state.run();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["edit", "account"])("cancels and discards results after %s changes", async (reason) => {
    let resolve!: (value: { editedText: string }) => void;
    mocks.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const state = setup();
    const result = state.run();
    if (reason === "edit") state.edit();
    else for (const listener of mocks.listeners) listener({ user: { id: 2 } }, { user: { id: 1 } });
    expect(mocks.request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ editedText: "stale()" });
    expect(await result).toEqual({ items: [] });
  });

  it("treats unavailable providers as no suggestion", async () => {
    mocks.request.mockRejectedValue(new Error("No key"));
    expect(await setup().run()).toEqual({ items: [] });
  });

  it("pauses on hosted billing errors, notifies once, and stops requesting", async () => {
    mocks.request.mockRejectedValue(new InlineEditError("Requires Pro.", 402, { hosted: true }));
    await setup().run();
    expect(status()).toEqual({ kind: "paused", reason: "credits", message: "Requires Pro." });
    expect(toast.warning).toHaveBeenCalledOnce();
    await setup().run();
    expect(mocks.request).toHaveBeenCalledOnce();
    useIntelligenceCompletionStore.getState().actions.resume();
    await setup().run();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("shows a signed-out pause without a notice", async () => {
    mocks.authenticated = false;
    mocks.request.mockRejectedValue(new InlineEditError("Sign in.", 401, { hosted: true }));
    await setup().run();
    expect(status()).toMatchObject({ kind: "paused", reason: "sign-in" });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("pauses for organization policy only when Athas refuses", async () => {
    mocks.request.mockRejectedValueOnce(new InlineEditError("Model not allowed", 403));
    await setup().run();
    expect(status()).toEqual({ kind: "error", message: "Model not allowed" });
    mocks.request.mockRejectedValueOnce(new InlineEditError("Disabled", 403, { hosted: true }));
    await setup().run();
    expect(status()).toMatchObject({ kind: "paused", reason: "policy" });
  });

  it("reports other failures and clears them after a successful request", async () => {
    mocks.request.mockRejectedValueOnce(new InlineEditError("Server busy", 503, { hosted: true }));
    await setup().run();
    expect(status()).toEqual({ kind: "error", message: "Server busy" });
    mocks.request.mockResolvedValueOnce({ editedText: "value" });
    await setup().run();
    expect(status()).toEqual({ kind: "idle" });
  });

  it("sends recent edits and nearby diagnostics as context", async () => {
    mocks.request.mockResolvedValue({ editedText: "x" });
    const other = {
      uri: { scheme: "athas", authority: "editor", path: "/project/other.ts", query: "" },
      isDisposed: () => false,
      getLineCount: () => 3,
      getLineMaxColumn: () => 20,
      getValueInRange: () => "export const other = 1;",
    };
    recordRecentEdit(other as unknown as Monaco.editor.ITextModel, [
      {
        range: { startLineNumber: 2 } as Monaco.IRange,
        text: "1",
      },
    ]);
    mocks.markers.mockReturnValue([
      { severity: 8, message: "Missing return", startLineNumber: 3 },
      { severity: 1, message: "hint", startLineNumber: 1 },
    ]);
    await setup().run();
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        recentEdits: [{ filePath: "/project/other.ts", snippet: "export const other = 1;" }],
        diagnostics: [{ line: 3, severity: "error", message: "Missing return" }],
      }),
      expect.anything(),
    );
  });
});

describe("Intelligence completion context", () => {
  it("keeps the latest edits and skips the one at the cursor", () => {
    const model = (path: string) => ({
      uri: { scheme: "athas", authority: "editor", path, query: "" },
      isDisposed: () => false,
      getLineCount: () => 100,
      getLineMaxColumn: () => 10,
      getValueInRange: () => `edit in ${path}`,
    });
    for (let index = 0; index < 7; index++) {
      recordRecentEdit(model(`/f${index}.ts`) as unknown as Monaco.editor.ITextModel, [
        { range: { startLineNumber: 10 } as Monaco.IRange, text: "x" },
      ]);
    }
    recordRecentEdit(model("/.env") as unknown as Monaco.editor.ITextModel, [
      { range: { startLineNumber: 1 } as Monaco.IRange, text: "SECRET=1" },
    ]);
    const edits = getRecentEdits("/f6.ts", 10);
    expect(edits.map((edit) => edit.filePath)).toEqual(["/f2.ts", "/f3.ts", "/f4.ts", "/f5.ts"]);
  });

  it("limits diagnostics to nearby warnings and errors", () => {
    const diagnostics = getNearbyDiagnostics(
      [
        { severity: 4, message: "far", startLineNumber: 200 },
        { severity: 4, message: "near warning", startLineNumber: 12 },
        { severity: 8, message: "error", startLineNumber: 9 },
        { severity: 2, message: "info", startLineNumber: 10 },
      ],
      10,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["error", "near warning"]);
  });

  it("drops a repeated closing line from multi-line completions", () => {
    expect(trimSuffixOverlap("{\n  return 1;\n}", "}\n")).toBe("{\n  return 1;\n");
    expect(trimSuffixOverlap("value", "value")).toBe("value");
    expect(trimSuffixOverlap("a\nb", "c")).toBe("a\nb");
  });
});
