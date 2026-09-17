// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SharingSettings } from "../components/sharing-settings";

const api = vi.hoisted(() => ({ options: vi.fn(), sync: vi.fn(), copy: vi.fn(), toast: vi.fn() }));
vi.mock("../services/share-api", () => ({
  fetchShareOptions: api.options,
  setSessionSync: api.sync,
  revokeShare: vi.fn(),
  updateShare: vi.fn(),
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText: api.copy }));
vi.mock("@/features/layout/contexts/toast-context", () => ({
  useToast: () => ({ showToast: api.toast }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/config/services", () => ({
  getServiceUrls: () => ({ websiteBaseUrl: "https://athas.dev" }),
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("../components/share-access-dialog", () => ({ ShareAccessDialog: () => null }));
const options = {
  pro: true,
  sessionsEnabled: false,
  excludedSources: [],
  organizations: [],
  items: [
    {
      id: "link-1",
      title: "Example",
      visibility: "public",
      kind: "snippet",
      live: false,
      revision: 1,
      emails: [],
      workspaceId: null,
      updatedAt: 0,
    },
  ],
};
let root: Root;
let container: HTMLDivElement;
function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.options.mockResolvedValue(options);
  api.copy.mockResolvedValue(undefined);
  api.sync.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Sharing settings recovery", () => {
  it("retries an initial failure without reopening settings", async () => {
    api.options.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => root.render(<SharingSettings />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Offline");
    await act(async () => button("Retry").click());
    expect(container.textContent).toContain("Example");
    expect(container.textContent).not.toContain("Offline");
    expect(api.options).toHaveBeenCalledTimes(2);
  });

  it("copies locally with success feedback and no sharing refresh", async () => {
    await act(async () => root.render(<SharingSettings />));
    await act(async () => button("Copy link").click());
    expect(api.copy).toHaveBeenCalledWith("https://athas.dev/s/link-1");
    expect(api.toast).toHaveBeenCalledWith({ message: "Link copied", type: "success" });
    expect(api.options).toHaveBeenCalledTimes(1);
  });

  it("reports clipboard failures without claiming the link was copied", async () => {
    api.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await act(async () => root.render(<SharingSettings />));
    await act(async () => button("Copy link").click());
    expect(api.toast).toHaveBeenCalledExactlyOnceWith({
      message: "Clipboard unavailable",
      type: "error",
    });
    expect(api.options).toHaveBeenCalledTimes(1);
  });

  it("refreshes once after changing session sync", async () => {
    await act(async () => root.render(<SharingSettings />));
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => toggle.click());
    expect(api.sync).toHaveBeenCalledWith(true);
    expect(api.options).toHaveBeenCalledTimes(2);
  });
  it("preserves a failed action message and retries the refresh with existing items", async () => {
    await act(async () => root.render(<SharingSettings />));
    api.sync.mockRejectedValueOnce(new Error("Could not update sync"));
    api.options.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(container.textContent).toContain("Could not update sync");
    expect(container.textContent).toContain("Example");
    expect(container.textContent).not.toContain("Offline");
    await act(async () => button("Retry").click());
    expect(container.textContent).not.toContain("Could not update sync");
    expect(api.options).toHaveBeenCalledTimes(3);
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
