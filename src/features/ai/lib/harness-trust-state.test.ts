import { describe, expect, test } from "bun:test";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { getHarnessTrustState } from "./harness-trust-state";

const createEvent = (
  kind: ChatAcpEvent["kind"],
  {
    label = kind,
    detail,
    state = "info",
  }: Partial<Pick<ChatAcpEvent, "label" | "detail" | "state">> = {},
): ChatAcpEvent => ({
  id: `${kind}-${label}`,
  kind,
  label,
  detail,
  state,
  timestamp: new Date("2026-03-27T00:00:00.000Z"),
});

describe("harness trust state", () => {
  test("keeps healthy idle sessions quiet", () => {
    expect(
      getHarnessTrustState({
        agentId: "pi",
        mode: "chat",
        isRunning: false,
        queueCount: 0,
        pendingPermissionCount: 0,
        stalePermissionCount: 0,
        latestEvent: null,
      }),
    ).toEqual({
      kind: "idle",
      agentLabel: "Pi",
      modeLabel: "Chat",
      stateLabel: "Idle",
      detail: null,
      showRailStatus: false,
    });
  });

  test("surfaces pending permissions as attention-needed state", () => {
    expect(
      getHarnessTrustState({
        agentId: "pi",
        mode: "plan",
        isRunning: false,
        queueCount: 0,
        pendingPermissionCount: 2,
        stalePermissionCount: 0,
        latestEvent: createEvent("permission", { label: "Permission requested" }),
      }),
    ).toEqual({
      kind: "attention",
      agentLabel: "Pi",
      modeLabel: "Plan",
      stateLabel: "Permission needed",
      detail: "2 decisions are waiting",
      showRailStatus: true,
    });
  });

  test("keeps stale permission failures visible", () => {
    expect(
      getHarnessTrustState({
        agentId: "pi",
        mode: "chat",
        isRunning: false,
        queueCount: 0,
        pendingPermissionCount: 0,
        stalePermissionCount: 1,
        latestEvent: createEvent("permission", { label: "Permission expired", state: "error" }),
      }),
    ).toEqual({
      kind: "attention",
      agentLabel: "Pi",
      modeLabel: "Chat",
      stateLabel: "Permission expired",
      detail: "1 request needs to be re-run",
      showRailStatus: true,
    });
  });

  test("prefers live running state over stale errors", () => {
    expect(
      getHarnessTrustState({
        agentId: "pi",
        mode: "chat",
        isRunning: true,
        queueCount: 1,
        pendingPermissionCount: 0,
        stalePermissionCount: 0,
        latestEvent: createEvent("error", {
          label: "Old error",
          detail: "Something broke before",
          state: "error",
        }),
      }),
    ).toEqual({
      kind: "running",
      agentLabel: "Pi",
      modeLabel: "Chat",
      stateLabel: "Running",
      detail: "1 queued follow-up",
      showRailStatus: true,
    });
  });

  test("keeps the latest error sticky when the session is idle", () => {
    expect(
      getHarnessTrustState({
        agentId: "pi",
        mode: "chat",
        isRunning: false,
        queueCount: 0,
        pendingPermissionCount: 0,
        stalePermissionCount: 0,
        latestEvent: createEvent("error", {
          label: "Prompt failed",
          detail: "ACP agent process exited: exit status: 1",
          state: "error",
        }),
      }),
    ).toEqual({
      kind: "error",
      agentLabel: "Pi",
      modeLabel: "Chat",
      stateLabel: "Needs attention",
      detail: "ACP agent process exited: exit status: 1",
      showRailStatus: true,
    });
  });
});
