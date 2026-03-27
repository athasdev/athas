import { describe, expect, test } from "bun:test";
import { buildPiNativePromptMessage } from "./pi-native-prompt";
import type { ContextInfo } from "./types";

const context: ContextInfo = {
  projectRoot: "/home/fsos/Developer/athas",
  activeBuffer: {
    id: "buffer-1",
    path: "agent://pi-native/harness",
    name: "Harness",
    content: "",
    isDirty: false,
    isSQLite: false,
    isActive: true,
  },
};

describe("buildPiNativePromptMessage", () => {
  test("keeps slash commands raw for native Pi command execution", () => {
    expect(buildPiNativePromptMessage("/smoke-confirm", context)).toBe("/smoke-confirm");
    expect(buildPiNativePromptMessage("   /smoke-confirm yes", context)).toBe("/smoke-confirm yes");
  });

  test("prepends context for normal native prompts", () => {
    const result = buildPiNativePromptMessage("Reply with exactly READY.", context);

    expect(result).toContain("Project: athas");
    expect(result).toContain("Currently editing:");
    expect(result).toContain("Reply with exactly READY.");
  });
});

describe("PiNativeStreamHandler permission events", () => {
  test("forwards native permission requests to the UI handlers", async () => {
    (globalThis as typeof globalThis & { window?: unknown }).window = {
      __TAURI_OS_PLUGIN_INTERNALS__: {
        platform: "linux",
        arch: "x86_64",
      },
    } as unknown as Window & typeof globalThis;

    const { PiNativeStreamHandler } = await import("./pi-native-handler");
    const permissionEvents: unknown[] = [];
    const handler = new PiNativeStreamHandler({
      onChunk() {},
      onComplete() {},
      onError() {},
      onPermissionRequest(event) {
        permissionEvents.push(event);
      },
    });

    (handler as any).handleEvent({
      type: "permission_request",
      routeKey: "panel",
      requestId: "perm-1",
      permissionType: "confirm",
      resource: "Smoke confirm",
      description: "Approve the native Pi permission smoke test?",
      title: "Smoke confirm",
      placeholder: null,
      defaultValue: null,
      options: null,
    });

    expect(permissionEvents).toEqual([
      expect.objectContaining({
        type: "permission_request",
        requestId: "perm-1",
        resource: "Smoke confirm",
      }),
    ]);
  });
});
