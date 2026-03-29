import { beforeEach, describe, expect, mock, test } from "bun:test";

const reloadSessionResourcesCalls: string[] = [];

mock.module("@/utils/pi-native-handler", () => ({
  PiNativeStreamHandler: {
    reloadSessionResources: mock(async (scopeId: string) => {
      reloadSessionResourcesCalls.push(scopeId);
      return null;
    }),
  },
}));

const storeState = {
  chatScopes: {
    panel: {},
    "harness:main": {},
    "harness:other": {},
  },
  getCurrentChat(scopeId: string) {
    switch (scopeId) {
      case "panel":
        return {
          acpState: {
            runtimeState: {
              source: "pi-native",
              workspacePath: "/tmp/project",
            },
          },
        };
      case "harness:main":
        return {
          acpState: {
            runtimeState: {
              source: "pi-native",
              workspacePath: "/tmp/project",
            },
          },
        };
      case "harness:other":
        return {
          acpState: {
            runtimeState: {
              source: "legacy-acp-bridge",
              workspacePath: "/tmp/project",
            },
          },
        };
      default:
        return undefined;
    }
  },
};

mock.module("@/features/ai/store/store", () => ({
  useAIChatStore: {
    getState: () => storeState,
  },
}));

describe("pi settings runtime helpers", () => {
  beforeEach(() => {
    reloadSessionResourcesCalls.length = 0;
  });

  test("reloads active pi-native scopes in the current workspace only", async () => {
    const { reloadActivePiNativeSessionsForWorkspace } = await import("./pi-settings-runtime");

    const refreshedScopes = await reloadActivePiNativeSessionsForWorkspace("/tmp/project");

    expect(refreshedScopes).toEqual(["panel", "harness:main"]);
    expect(reloadSessionResourcesCalls).toEqual(["panel", "harness:main"]);
  });

  test("subscribes refresh handlers for focus and visible app restores", async () => {
    const focusHandlers: Array<() => void> = [];
    const visibilityHandlers: Array<() => void> = [];
    const refreshCalls: string[] = [];
    const windowTarget = {
      addEventListener(type: string, handler: () => void) {
        if (type === "focus") {
          focusHandlers.push(handler);
        }
      },
      removeEventListener() {},
    };
    const documentTarget = {
      visibilityState: "hidden",
      addEventListener(type: string, handler: () => void) {
        if (type === "visibilitychange") {
          visibilityHandlers.push(handler);
        }
      },
      removeEventListener() {},
    };

    const { subscribePiSettingsAutoRefresh } = await import("./pi-settings-runtime");
    subscribePiSettingsAutoRefresh(
      () => {
        refreshCalls.push("refresh");
      },
      { windowTarget, documentTarget },
    );

    focusHandlers[0]?.();
    visibilityHandlers[0]?.();
    documentTarget.visibilityState = "visible";
    visibilityHandlers[0]?.();

    expect(refreshCalls).toEqual(["refresh", "refresh"]);
  });
});
