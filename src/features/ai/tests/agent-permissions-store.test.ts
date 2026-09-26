import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  selectChatPermissions,
  useAgentPermissionsStore,
} from "@/features/ai/stores/agent-permissions.store";
import { applyAcpEvent } from "@/features/ai/services/acp-event-sync";
import type {
  AgentPermissionResponder,
  PendingAgentPermission,
} from "@/features/ai/types/agent-permission.types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const intelligence = vi.hoisted(() => ({ pending: new Set<string>(), answers: [] as unknown[] }));
vi.mock("@/features/ai/intelligence/services/intelligence-agent-permissions", () => ({
  isIntelligencePermissionPending: (requestId: string) => intelligence.pending.has(requestId),
  respondToIntelligencePermission: (requestId: string, approved: boolean) =>
    intelligence.answers.push([requestId, approved]),
}));

function permission(
  requestId: string,
  chatId: string,
  responder: AgentPermissionResponder = "acp",
): PendingAgentPermission {
  return {
    requestId,
    chatId,
    responder,
    description: "Edit file",
    permissionType: "edit",
    resource: "a.ts",
    options: [],
  };
}

const { actions } = useAgentPermissionsStore.getState();
const requestIds = () =>
  useAgentPermissionsStore.getState().permissions.map((item) => item.requestId);

describe("agent permission store", () => {
  beforeEach(() => {
    useAgentPermissionsStore.setState({ permissions: [] });
    vi.mocked(invoke).mockReset();
    intelligence.pending.clear();
    intelligence.answers.length = 0;
  });

  it("keeps each chat's prompts until the agent closes them", () => {
    actions.add(permission("p1", "chat-a"));
    actions.add(permission("p1", "chat-a"));
    actions.add(permission("p2", "chat-b"));
    expect(
      selectChatPermissions(useAgentPermissionsStore.getState().permissions, "chat-a"),
    ).toHaveLength(1);

    applyAcpEvent({ type: "request_closed", requestId: "p1" });
    expect(requestIds()).toEqual(["p2"]);
  });

  it("answers through the agent that asked and drops the prompt even when that fails", async () => {
    actions.add(permission("p1", "chat-a"));
    actions.add(permission("intelligence:p2", "chat-a", "intelligence"));
    vi.mocked(invoke).mockRejectedValueOnce(new Error("gone"));

    await expect(actions.respond("p1", true, "allow")).rejects.toThrow("gone");
    expect(invoke).toHaveBeenCalledWith("respond_acp_permission", {
      args: { requestId: "p1", approved: true, cancelled: false, optionId: "allow" },
    });
    await actions.respond("intelligence:p2", false);
    expect(intelligence.answers).toEqual([["intelligence:p2", false]]);
    expect(requestIds()).toEqual([]);
  });

  it("refuses Codex prompts of a stopped turn and leaves others to the agent", async () => {
    actions.add(permission("7", "chat-a", "codex"));
    actions.add(permission("p2", "chat-a"));
    actions.add(permission("p3", "chat-b"));
    vi.mocked(invoke).mockResolvedValue(undefined);

    await actions.dropStoppedTurn("chat-a");
    expect(requestIds()).toEqual(["p3"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("respond_codex_request", {
      response: { requestId: 7, decision: { decision: "decline" } },
    });
  });

  it("drops only the prompts a finished turn of Athas's own agent no longer waits on", () => {
    actions.add(permission("intelligence:done", "chat-a", "intelligence"));
    actions.add(permission("intelligence:open", "chat-a", "intelligence"));
    actions.add(permission("p3", "chat-a"));
    intelligence.pending.add("intelligence:open");

    actions.dropSettled("chat-a");
    expect(requestIds()).toEqual(["intelligence:open", "p3"]);
  });

  it("cancels a deleted chat's prompts", () => {
    actions.add(permission("p1", "chat-a"));
    vi.mocked(invoke).mockResolvedValue(undefined);
    actions.cancelChat("chat-a");
    expect(requestIds()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("respond_acp_permission", {
      args: { requestId: "p1", approved: false, cancelled: true, optionId: undefined },
    });
  });
});
