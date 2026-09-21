// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useInlineEdit } from "../inline-edit/use-inline-edit";
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
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useInlineEdit>;

function Editor({ content = "original", id = "one" }: { content?: string; id?: string }) {
  const lastScrollRef = useRef({ top: 0, left: 0 });
  controller = useInlineEdit({
    buffer: { id, content, path: `/${id}.ts`, language: "typescript" },
    viewKey: "editor",
    selection: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: content.length, offset: content.length },
    },
    fontSize: 14,
    fontFamily: "monospace",
    lineHeight: 20,
    tabSize: 2,
    lastScrollRef,
    resolveModelPosition: () => ({ top: 20, left: 20 }),
    applyInlineEdit,
    setCursorPosition,
    setSelection,
  });
  return <InlineEditPopover state={controller} />;
}

async function press(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    container.querySelector("input")!.dispatchEvent(event);
  });
  return event;
}
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
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "updated" }),
    );
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("does not overwrite content changed during the request and allows retry", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ editedText: "safe update" });
    await press();
    await act(async () => root.render(<Editor content="newer user edit" />));
    await act(async () => pending.resolve({ editedText: "stale update" }));
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(setCursorPosition).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The file changed while the edit was running.");
    expect(controller.isInlineEditRunning).toBe(false);
    await press();
    expect(requestInlineEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedText: "newer user edit" }),
      expect.anything(),
    );
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "safe update" }),
    );
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
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(controller.isInlineEditRunning).toBe(true);
    await press();
    expect(requestInlineEdit).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ editedText: "second updated" }));
    expect(applyInlineEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ newContent: "second updated" }),
    );
  });

  it("does not apply an edit after the popover closes and reopens", async () => {
    const pending = Promise.withResolvers<{ editedText: string }>();
    vi.mocked(requestInlineEdit).mockReturnValue(pending.promise);
    await press();
    await act(async () => useInlineEditToolbarStore.getState().actions.hide());
    await act(async () => useInlineEditToolbarStore.getState().actions.show("editor"));
    await act(async () => pending.resolve({ editedText: "stale session" }));
    expect(applyInlineEdit).not.toHaveBeenCalled();
    expect(useInlineEditToolbarStore.getState().isVisible).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("unlocks the current request after failure so it can be retried", async () => {
    vi.mocked(requestInlineEdit)
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce({ editedText: "retry result" });
    await press();
    expect(controller.isInlineEditRunning).toBe(false);
    expect(container.textContent).toContain("Inline edit failed. Please try again.");
    await press();
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
