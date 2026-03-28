import { afterAll, describe, expect, mock, test } from "bun:test";

const tauriInvoke = mock(async (command: string) => {
  switch (command) {
    case "plugin:store|load":
      return 1;
    case "plugin:store|get_store":
      return null;
    case "plugin:store|get":
      return [null, false];
    case "plugin:store|has":
      return false;
    case "plugin:store|keys":
    case "plugin:store|values":
    case "plugin:store|entries":
      return [];
    case "plugin:store|length":
      return 0;
    default:
      return null;
  }
});

Object.assign(globalThis, {
  window: {
    __TAURI_INTERNALS__: {
      invoke: tauriInvoke,
      metadata: {
        currentWindow: {
          label: "main",
        },
      },
    },
    __TAURI_OS_PLUGIN_INTERNALS__: {
      platform: "linux",
      arch: "x86_64",
      eol: "\n",
      version: "test",
      family: "unix",
      os_type: "linux",
      exe_extension: "",
    },
  },
});

mock.module("@tauri-apps/api/core", () => ({
  SERIALIZE_TO_IPC_FN: "__TAURI_TO_IPC_KEY__",
  invoke: tauriInvoke,
  Channel: class Channel {},
  Resource: class Resource {
    constructor(public rid: number) {}
  },
  transformCallback: () => 1,
  convertFileSrc: (path: string) => path,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: mock(async () => () => {}),
  once: mock(async () => () => {}),
  emit: mock(async () => {}),
  emitTo: mock(async () => {}),
  TauriEvent: {
    WINDOW_RESIZED: "tauri://resize",
  },
}));

mock.module("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

mock.module("@tauri-apps/plugin-store", () => ({
  load: mock(async () => ({
    get: mock(async () => undefined),
    set: mock(async () => {}),
    save: mock(async () => {}),
    reload: mock(async () => {}),
    close: mock(async () => {}),
  })),
}));

mock.module("@/features/settings/store", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        aiDefaultSessionMode: "one",
      },
    }),
  },
  waitForSettingsInitialization: () => Promise.resolve(),
  initializeSettingsStore: () => Promise.resolve(),
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(() => {
  mock.restore();
});

describe("AcpStreamHandler terminal event settling", () => {
  test("keeps trailing content when prompt_complete arrives first", async () => {
    const { AcpStreamHandler } = await import("./acp-handler");
    const chunks: string[] = [];
    let completed = 0;
    let errored = 0;

    const handler = new AcpStreamHandler("pi", {
      scopeId: "harness:harness",
      resumeKey: "harness:harness",
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
      onComplete: () => {
        completed += 1;
      },
      onError: () => {
        errored += 1;
      },
    }) as any;

    handler.sessionId = "session-1";

    handler.handleAcpEvent({
      type: "prompt_complete",
      routeKey: "harness:harness",
      sessionId: "session-1",
      stopReason: "end_turn",
    });

    expect(completed).toBe(0);

    handler.handleAcpEvent({
      type: "content_chunk",
      routeKey: "harness:harness",
      sessionId: "session-1",
      content: {
        type: "text",
        text: "READY",
      },
      isComplete: false,
    });

    await sleep(150);

    expect(chunks).toEqual(["READY"]);
    expect(completed).toBe(1);
    expect(errored).toBe(0);
  });

  test("keeps trailing content when error arrives before the final chunk", async () => {
    const { AcpStreamHandler } = await import("./acp-handler");
    const chunks: string[] = [];
    const errors: string[] = [];

    const handler = new AcpStreamHandler("pi", {
      scopeId: "harness:harness",
      resumeKey: "harness:harness",
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
      onComplete: () => {},
      onError: (error) => {
        errors.push(error);
      },
    }) as any;

    handler.sessionId = "session-1";

    handler.handleAcpEvent({
      type: "error",
      routeKey: "harness:harness",
      sessionId: "session-1",
      error:
        "Exec ended early: insufficient permission to proceed. Re-run with --auto medium or --auto high.",
    });

    expect(errors).toEqual([]);

    handler.handleAcpEvent({
      type: "content_chunk",
      routeKey: "harness:harness",
      sessionId: "session-1",
      content: {
        type: "text",
        text: "Exec ended early: insufficient permission to proceed.",
      },
      isComplete: false,
    });

    await sleep(150);

    expect(chunks).toEqual(["Exec ended early: insufficient permission to proceed."]);
    expect(errors).toEqual([
      "Exec ended early: insufficient permission to proceed. Re-run with --auto medium or --auto high.",
    ]);
  });
});
