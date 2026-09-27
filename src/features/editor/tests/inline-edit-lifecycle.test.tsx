// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { composeInlineEditFollowUp, useInlineEdit } from "../inline-edit/use-inline-edit";
import { rebaseInlineEditRange } from "../inline-edit/inline-edit-rebase";
import { InlineEditPopover } from "../inline-edit/inline-edit-popover";
import { useInlineEditToolbarStore } from "../stores/inline-edit-toolbar.store";
import { requestInlineEdit } from "../services/editor-inline-edit-service";
import { toast } from "sonner";

vi.mock("monaco-editor", () => ({}));
vi.mock("@/features/ai/stores/ai-chat.store", () => {
  const state = {
    providerApiKeys: new Map([["openai", true]]),
    actions: { checkAllProviderApiKeys: vi.fn() },
  };
  return {
    useAIChatStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock("@/features/settings/stores/settings.store", () => {
  const state = {
    settings: { aiProviderId: "openai", aiModelId: "test-model" },
    actions: { updateSetting: vi.fn() },
  };
  return { useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
vi.mock("@/features/window/stores/auth.store", () => {
  const state = { isAuthenticated: false, subscription: null };
  return { useAuthStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
vi.mock("../services/editor-inline-edit-service", () => ({
  requestInlineEdit: vi.fn(),
  InlineEditError: class extends Error {},
}));
vi.mock("../inline-edit/inline-edit-model-selector", () => ({
  InlineEditModelSelector: () => null,
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

const applyInlineEdit = vi.fn();
const setCursorPosition = vi.fn();
const setSelection = vi.fn();
const clearPreview = vi.fn();
const previewInlineEdit = vi.fn(() => clearPreview);
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useInlineEdit>;

function Editor({
  content = "original",
  id = "one",
  selectionEnd = content.length,
}: {
  content?: string;
  id?: string;
  selectionEnd?: number;
}) {
  const lastScrollRef = useRef({ top: 0, left: 0 });
  controller = useInlineEdit({
    buffer: { id, content, path: `/${id}.ts`, language: "typescript" },
    viewKey: "editor",
    selection: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: selectionEnd, offset: selectionEnd },
    },
    fontSize: 14,
    fontFamily: "monospace",
    lineHeight: 20,
    tabSize: 2,
    lastScrollRef,
    resolveModelPosition: () => ({ top: 20, left: 20 }),
    applyInlineEdit,
    previewInlineEdit,
    setCursorPosition,
    setSelection,
  });
  return <InlineEditPopover state={controller} />;
}

function input() {
  return document.querySelector<HTMLInputElement>("input[aria-label]")!;
}

async function press(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    input().dispatchEvent(event);
  });
  return event;
}

async function type(value: string) {
  await act(async () => {
    const element = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const accept = () => press({ metaKey: true });
const escape = () => press({ key: "Escape" });

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  useInlineEditToolbarStore.getState().actions.show("editor");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Editor />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useInlineEditToolbarStore.getState().actions.hide();
  vi.unstubAllGlobals();
});

describe("Inline edit request ownership", () => {
  it("preserves IME confirmation, then starts only one edit for repeated Enter", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit).mockReturnValue(pending.promise);
    expect((await press({ isComposing: true })).defaultPrevented).toBe(false);
    await press({ keyCode: 229 });
    expect(requestInlineEdit).not.toHaveBeenCalled();
    await press();
    await press();
    expect(requestInlineEdit).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ editedText: "updated" }));
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(previewInlineEdit).toHaveBeenLastCalledWith({
      startOffset: 0,
      endOffset: 8,
      editedText: "updated",
    });
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "updated" }),
    );
    expect(clearPreview).toHaveBeenCalled();
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not overwrite content changed inside the range and allows retry", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ editedText: "safe update" });
    await press();
    await act(async () => root.render(<Editor content="newer user edit" />));
    await act(async () => pending.resolve({ editedText: "stale update" }));
    expect(previewInlineEdit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The selected code changed while the edit");
    expect(controller.isInlineEditRunning).toBe(false);
    await press();
    expect(requestInlineEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedText: "newer user edit" }),
      expect.anything(),
    );
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "safe update" }),
    );
  });

  it("rebases the proposal when the file changed outside the edited range", async () => {
    await act(async () => root.render(<Editor content="original tail" selectionEnd={8} />));
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit).mockReturnValueOnce(pending.promise);
    await press();
    await act(async () => root.render(<Editor content="new original tail" selectionEnd={8} />));
    await act(async () => root.render(<Editor content="new original tail!" selectionEnd={8} />));
    await act(async () => pending.resolve({ editedText: "updated" }));
    expect(previewInlineEdit).toHaveBeenLastCalledWith({
      startOffset: 4,
      endOffset: 12,
      editedText: "updated",
    });
    await act(async () => root.render(<Editor content="an new original tail!" selectionEnd={8} />));
    await act(async () =>
      root.render(<Editor content="an new original tail!?" selectionEnd={8} />),
    );
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "an new updated tail!?" }),
    );
  });

  it("blocks accepting a proposal whose original code was edited", async () => {
    vi.mocked(requestInlineEdit).mockResolvedValueOnce({ editedText: "updated" });
    await press();
    await act(async () => root.render(<Editor content="origXinal" />));
    await accept();
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(controller.inlineEditProposalConflict).toBe(true);
    expect(document.body.textContent).toContain("The selected code changed while the edit");
  });

  it("refines a proposal with a follow-up that sends the previous proposal", async () => {
    vi.mocked(requestInlineEdit)
      .mockResolvedValueOnce({ editedText: "a long update" })
      .mockResolvedValueOnce({ editedText: "short" });
    await type("rewrite it");
    await press();
    expect(controller.inlineEditProposal?.editedText).toBe("a long update");
    expect(input().value).toBe("");
    await type("make it shorter");
    await press();
    expect(requestInlineEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedText: "a long update",
        instruction: expect.stringMatching(/rewrite it.*make it shorter/),
      }),
      expect.anything(),
    );
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "short" }),
    );
  });

  it("stops a running request with Escape and keeps the popover open", async () => {
    vi.mocked(requestInlineEdit).mockReturnValueOnce(new Promise(() => {}));
    await press();
    const signal = vi.mocked(requestInlineEdit).mock.calls[0][1]?.signal;
    expect(controller.isInlineEditRunning).toBe(true);
    await escape();
    expect(signal?.aborted).toBe(true);
    expect(controller.isInlineEditRunning).toBe(false);
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(true);
    await escape();
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(false);
  });

  it("rejects a proposal with Escape without applying it", async () => {
    vi.mocked(requestInlineEdit).mockResolvedValueOnce({ editedText: "updated" });
    await press();
    await escape();
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(clearPreview).toHaveBeenCalled();
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(false);
  });

  it("ignores an old file response without unlocking a newer file request", async () => {
    const first = Promise.withResolvers<{ editedText: string }>();
    const second = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await press();
    await act(async () => root.render(<Editor id="two" content="second file" />));
    await press();
    await act(async () => first.resolve({ editedText: "old file response" }));
    expect(previewInlineEdit).not.toHaveBeenCalled();
    expect(controller.isInlineEditRunning).toBe(true);
    await press();
    expect(requestInlineEdit).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ editedText: "second updated" }));
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "second updated" }),
    );
  });

  it("does not show an edit after the popover closes and reopens", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit).mockReturnValue(pending.promise);
    await press();
    await act(async () => useInlineEditToolbarStore.getState().actions.hide());
    await act(async () => useInlineEditToolbarStore.getState().actions.show("editor"));
    await act(async () => pending.resolve({ editedText: "stale session" }));
    expect(previewInlineEdit).not.toHaveBeenCalled();
    expect(controller.inlineEditProposal).toBeNull();
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(true);
  });

  it("reports a failure once inline and allows a retry", async () => {
    vi.mocked(requestInlineEdit)
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce({ editedText: "retry result" });
    await press();
    expect(controller.isInlineEditRunning).toBe(false);
    expect(document.body.textContent).toContain("Inline edit failed. Please try again.");
    expect(toast.error).not.toHaveBeenCalled();
    await press();
    await accept();
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "retry result" }),
    );
  });

  it("ignores a failed request after unmount", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit).mockReturnValue(pending.promise);
    await press();
    await act(async () => root.render(null));
    await act(async () => pending.reject(new Error("Disconnected")));
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Inline edit follow-up instruction", () => {
  it("stays within the server instruction limit and keeps the follow-up", () => {
    const instruction = composeInlineEditFollowUp("x".repeat(5000), "make it shorter");
    expect(instruction.length).toBeLessThanOrEqual(2000);
    expect(instruction).toContain("make it shorter");
  });
});

describe("Inline edit rebase", () => {
  it.each([
    ["abc XYZ def", "abc XYZ def!", 4, 7, { start: 4, end: 7 }],
    ["abc XYZ def", "123 abc XYZ def", 4, 7, { start: 8, end: 11 }],
    ["abc XYZ def", "abc XQZ def", 4, 7, null],
    ["abc XYZ def", "abcXYZ def", 4, 7, { start: 3, end: 6 }],
  ])("maps %j to %j", (previous, next, start, end, expected) => {
    expect(rebaseInlineEditRange(previous, next, start, end)).toEqual(expected);
  });
});
