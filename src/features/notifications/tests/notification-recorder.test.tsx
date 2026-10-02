// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { NotificationRecorder } from "../components/notification-recorder";
import { useNotificationsStore } from "../stores/notifications.store";

const sonner = vi.hoisted(() => ({ toasts: [] as Array<Record<string, unknown>> }));

vi.mock("sonner", () => ({
  useSonner: () => ({ toasts: sonner.toasts }),
}));

let container: HTMLDivElement;
let root: Root;

async function renderWithToasts(toasts: Array<Record<string, unknown>>) {
  sonner.toasts = toasts;
  await act(async () => root.render(<NotificationRecorder />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useNotificationsStore.getState().actions.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sonner.toasts = [];
});

describe("notification recorder", () => {
  it("records visible toasts in the notification history", async () => {
    await renderWithToasts([
      { id: 1, title: "Saved", type: "success" },
      { id: "push", title: "Push failed", description: "Remote rejected", type: "error" },
    ]);

    expect(useNotificationsStore.getState().notifications).toEqual([
      expect.objectContaining({
        id: "push",
        message: "Push failed",
        description: "Remote rejected",
        type: "error",
        category: "athas",
      }),
      expect.objectContaining({ id: "1", message: "Saved", type: "success" }),
    ]);
  });

  it("files loading, default, and unknown toast types as info", async () => {
    await renderWithToasts([
      { id: "a", title: "Indexing", type: "loading" },
      { id: "b", title: "Hello", type: "default" },
      { id: "c", title: "Plain" },
    ]);

    expect(
      useNotificationsStore.getState().notifications.map((notification) => notification.type),
    ).toEqual(["info", "info", "info"]);
  });

  it("skips dismissed toasts and toasts without a text title", async () => {
    await renderWithToasts([
      { id: "gone", dismiss: true },
      { id: "custom", title: { type: "span" } },
      { id: "rich", title: "Rich", description: { type: "div" } },
    ]);

    expect(useNotificationsStore.getState().notifications).toEqual([
      expect.objectContaining({ id: "rich", message: "Rich", description: undefined }),
    ]);
  });

  it("updates an existing entry when the same toast changes", async () => {
    await renderWithToasts([{ id: "sync", title: "Syncing", type: "loading" }]);
    await renderWithToasts([{ id: "sync", title: "Synced", type: "success" }]);

    expect(useNotificationsStore.getState().notifications).toEqual([
      expect.objectContaining({ id: "sync", message: "Synced", type: "success" }),
    ]);
  });
});
