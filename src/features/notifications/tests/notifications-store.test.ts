import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";

describe("notifications store", () => {
  beforeEach(() => {
    useNotificationsStore.getState().actions.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("categorizes ordinary app notifications as Athas notifications", () => {
    useNotificationsStore.getState().actions.record({
      id: "build-complete",
      message: "Build complete",
      type: "success",
    });

    expect(useNotificationsStore.getState().notifications[0]?.category).toBe("athas");
  });

  it("preserves an explicit Agent category when a notification is updated", () => {
    const record = useNotificationsStore.getState().actions.record;
    record({
      id: "agent:complete:run-1",
      message: "Agent finished",
      type: "success",
      category: "agent",
    });
    record({
      id: "agent:complete:run-1",
      message: "Agent finished again",
      type: "success",
    });

    expect(useNotificationsStore.getState().notifications[0]).toMatchObject({
      category: "agent",
      message: "Agent finished again",
    });
  });

  it("lists the newest notification first", () => {
    const { record } = useNotificationsStore.getState().actions;
    record({ id: "a", message: "First", type: "info" });
    record({ id: "b", message: "Second", type: "info" });

    expect(useNotificationsStore.getState().notifications.map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("moves an updated notification to the top, marks it unread, and keeps its creation time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { record, markAllRead } = useNotificationsStore.getState().actions;
    record({ id: "build", message: "Building", type: "info" });
    record({ id: "lint", message: "Linting", type: "info" });
    markAllRead();

    vi.setSystemTime(5_000);
    record({ id: "build", message: "Build failed", type: "error" });

    const [first, second] = useNotificationsStore.getState().notifications;
    expect(first).toMatchObject({
      id: "build",
      message: "Build failed",
      type: "error",
      read: false,
      createdAt: 1_000,
      updatedAt: 5_000,
    });
    expect(second).toMatchObject({ id: "lint", read: true });
    expect(useNotificationsStore.getState().notifications).toHaveLength(2);
  });

  it("keeps only the 20 most recent notifications", () => {
    const { record } = useNotificationsStore.getState().actions;
    for (let index = 0; index < 25; index++) {
      record({ id: `n${index}`, message: `Notification ${index}`, type: "info" });
    }

    const ids = useNotificationsStore.getState().notifications.map((item) => item.id);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("n24");
    expect(ids[19]).toBe("n5");
  });

  it("marks everything read, removes single entries, and clears the list", () => {
    const { record, markAllRead, remove, clear } = useNotificationsStore.getState().actions;
    record({ id: "a", message: "A", type: "warning" });
    record({ id: "b", message: "B", type: "error" });

    markAllRead();
    expect(useNotificationsStore.getState().notifications.every((item) => item.read)).toBe(true);

    remove("a");
    expect(useNotificationsStore.getState().notifications.map((item) => item.id)).toEqual(["b"]);

    clear();
    expect(useNotificationsStore.getState().notifications).toEqual([]);
  });
});
