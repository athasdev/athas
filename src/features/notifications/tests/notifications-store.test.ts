import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";

describe("notifications store", () => {
  beforeEach(() => {
    useNotificationsStore.getState().actions.clear();
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
});
