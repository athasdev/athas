import { describe, expect, test } from "bun:test";
import { createExtensionUiBridge } from "./extension-ui.mjs";

describe("pi-native extension ui bridge", () => {
  test("emits confirm dialogs as Athas permission requests and resolves approved responses", async () => {
    const events = [];
    const bridge = createExtensionUiBridge({
      routeKey: "harness:main",
      emitEvent(event) {
        events.push(event);
      },
    });

    const pending = bridge.uiContext.confirm("Clear session?", "All messages will be lost.");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "permission_request",
      routeKey: "harness:main",
      permissionType: "confirm",
      resource: "Clear session?",
      title: "Clear session?",
    });

    const requestId = events[0]?.requestId;
    expect(
      bridge.respond(requestId, {
        approved: true,
        cancelled: false,
        value: null,
      }),
    ).toBe(true);

    await expect(pending).resolves.toBe(true);
  });

  test("resolves select and input dialogs using the provided value", async () => {
    const events = [];
    const bridge = createExtensionUiBridge({
      routeKey: "harness:main",
      emitEvent(event) {
        events.push(event);
      },
    });

    const selectPromise = bridge.uiContext.select("Allow dangerous command?", ["Allow", "Block"]);
    const inputPromise = bridge.uiContext.input("Enter a branch name", "feature/pi-native");

    const selectRequest = events[0];
    const inputRequest = events[1];

    expect(selectRequest).toMatchObject({
      permissionType: "select",
      options: ["Allow", "Block"],
    });
    expect(inputRequest).toMatchObject({
      permissionType: "input",
      placeholder: "feature/pi-native",
    });

    bridge.respond(selectRequest.requestId, {
      approved: true,
      cancelled: false,
      value: "Allow",
    });
    bridge.respond(inputRequest.requestId, {
      approved: true,
      cancelled: false,
      value: "feature/pi-native",
    });

    await expect(selectPromise).resolves.toBe("Allow");
    await expect(inputPromise).resolves.toBe("feature/pi-native");
  });

  test("falls back safely when pending UI requests are cleared", async () => {
    const bridge = createExtensionUiBridge({
      routeKey: "harness:main",
      emitEvent() {},
    });

    const confirmPromise = bridge.uiContext.confirm("Dangerous?", "Proceed?");
    const inputPromise = bridge.uiContext.input("Name", "draft");

    bridge.clear();

    await expect(confirmPromise).resolves.toBe(false);
    await expect(inputPromise).resolves.toBeUndefined();
  });
});
