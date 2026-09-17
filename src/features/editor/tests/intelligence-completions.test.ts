import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Monaco from "monaco-editor";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  editors: vi.fn(),
  enabled: true,
  listeners: new Set<(...args: any[]) => void>(),
}));
vi.mock("monaco-editor", () => ({
  editor: { getEditors: mocks.editors, EditorOption: { readOnly: 1 } },
  languages: {},
  Range: { fromPositions: (start: unknown, end = start) => ({ start, end }) },
}));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => ({
  requestInlineEdit: mocks.request,
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { aiCompletion: mocks.enabled } }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: {
    subscribe: (listener: (...args: any[]) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  },
}));
vi.mock("@/features/ai/intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { subscribe: () => () => {} },
}));

import { createIntelligenceCompletionsProvider } from "../engines/monaco/intelligence-completions";

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
  mocks.listeners.clear();
});

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
});
