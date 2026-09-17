// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "../components/chat/chat-message";

vi.mock("../components/icons/provider-icons", () => ({ ProviderIcon: () => null }));
vi.mock("../components/messages/markdown-renderer", () => ({ default: () => null }));
let root: Root;
let container: HTMLDivElement;
const submit = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  submit.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ChatMessage
        message={{ id: "prompt-1", role: "user", content: "Hey", timestamp: new Date() }}
        isLastMessage
        canEditUserMessage
        onEditUserMessage={submit}
        userName="Mehmet"
        assistantIconId="athas"
        assistantLabel="Athas"
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function edit() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Edit prompt"]')!.click(),
  );
  return container.querySelector("textarea")!;
}
async function change(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("inline prompt editing", () => {
  it("opens the original text in a focused single-row editor and cancels with Escape", async () => {
    const input = await edit();
    expect(input.value).toBe("Hey");
    expect(input.rows).toBe(1);
    expect(document.activeElement).toBe(input);
    await change(input, "Unsent edit");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Hey");
    expect(submit).not.toHaveBeenCalled();
  });
  it("resubmits the edited multiline prompt using its existing message ID", async () => {
    const input = await edit();
    await change(input, "First line\nSecond line");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit).toHaveBeenCalledWith("prompt-1", "First line\nSecond line");
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("prevents sending an empty prompt", async () => {
    const input = await edit();
    await change(input, "   ");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    expect(submit).not.toHaveBeenCalled();
  });
});

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("../components/messages/tool-call-display", () => ({ ToolCallGroupDisplay: () => null }));
vi.mock("../components/messages/plan-block-display", () => ({ PlanBlockDisplay: () => null }));
vi.mock("@/extensions/ui/components/generative-ui-renderer", () => ({
  GenerativeUIRenderer: () => null,
}));
