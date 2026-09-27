// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AcpPermissionPrompt } from "../components/chat/acp-permission-prompt";
import { getPermissionShortcut } from "../lib/permission-shortcuts";
import type { AgentPermissionRequest } from "../types/agent-permission.types";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const permission = {
  requestId: "request-1",
  permissionType: "execute",
  resource: "bun test",
  description: "Run bun test",
  options: [
    { id: "always", name: "Always allow", kind: "allow_always" },
    { id: "once", name: "Allow", kind: "allow_once" },
    { id: "deny", name: "Deny", kind: "reject_once" },
  ],
} as unknown as AgentPermissionRequest;

let root: Root;
let container: HTMLDivElement;
const onRespond = vi.fn();

function prompt() {
  return container.querySelector<HTMLElement>('[aria-label="Permission request"]')!;
}

async function press(target: Element, key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onRespond.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <AcpPermissionPrompt permission={permission} queuedCount={0} onRespond={onRespond} />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Permission prompt keyboard", () => {
  it("takes focus when it appears and shows the shortcuts", () => {
    expect(document.activeElement).toBe(prompt());
    expect(container.textContent).toContain("Allow once");
    expect(container.textContent).toContain("Always allow this request type");
    expect(container.textContent).toContain("Deny once");
  });

  it("allows once on Enter, always on Cmd or Ctrl+Enter and denies on Escape", async () => {
    await press(prompt(), "Enter");
    expect(onRespond).toHaveBeenLastCalledWith(true, "once");
    await press(prompt(), "Enter", { metaKey: true });
    expect(onRespond).toHaveBeenLastCalledWith(true, "always");
    await press(prompt(), "Enter", { ctrlKey: true });
    expect(onRespond).toHaveBeenLastCalledWith(true, "always");
    await press(prompt(), "Escape");
    expect(onRespond).toHaveBeenLastCalledWith(false, "deny");
  });

  it("lets a focused button answer Enter itself", async () => {
    const deny = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Deny",
    )!;
    await press(deny, "Enter");
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("ignores Enter with Shift or Alt", () => {
    const base = { key: "Enter", metaKey: false, ctrlKey: false, altKey: false };
    expect(getPermissionShortcut({ ...base, shiftKey: true })).toBeNull();
    expect(getPermissionShortcut({ ...base, shiftKey: false, altKey: true })).toBeNull();
  });
});
