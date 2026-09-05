import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  captureAgentDrafts,
  registerAgentDraft,
  restoreAgentDrafts,
  takeAgentDraft,
  type AgentWindowDraft,
} from "@/features/ai/detached/agent-window-drafts";
import {
  getAgentWindowTransferBlocker,
  parseAgentWindowChannel,
} from "@/features/ai/detached/agent-window-state";

const idle = {
  agentRuns: {},
  pendingAgentLaunchRequest: null,
  agentMessageQueues: {},
  chatMessageLoadStates: {},
};
const draft: AgentWindowDraft = {
  text: "Keep this draft",
  images: [{ id: "image", dataUrl: "data:image/png;base64,AA==", name: "screen.png", size: 2 }],
  bufferIds: ["editor-1"],
  filePaths: ["/workspace/main.ts"],
  editorContexts: [],
};

afterEach(() => restoreAgentDrafts({}));

describe("Agents window transfer", () => {
  it("allows an idle view to move", () => {
    expect(getAgentWindowTransferBlocker(idle)).toBeNull();
  });

  it("blocks moving a running agent including an approval wait", () => {
    for (const phase of ["starting", "thinking", "approval", "tool", "waiting"] as const) {
      expect(
        getAgentWindowTransferBlocker({
          ...idle,
          agentRuns: {
            chat: { runId: "run", assistantMessageId: "message", agentId: "custom", phase },
          },
        }),
      ).not.toBeNull();
    }
  });

  it("blocks queued messages and launches before a run starts", () => {
    expect(
      getAgentWindowTransferBlocker({
        ...idle,
        agentMessageQueues: { chat: [{ content: "next" }] },
      }),
    ).not.toBeNull();
    expect(
      getAgentWindowTransferBlocker({
        ...idle,
        pendingAgentLaunchRequest: {
          chatId: "chat",
          agentId: "custom",
          prompt: "start",
          selectedBufferIds: [],
          selectedFilesPaths: [],
          editorSelections: [],
        },
      }),
    ).not.toBeNull();
  });

  it("does not mistake unloaded history metadata for a running agent", () => {
    expect(
      getAgentWindowTransferBlocker({ ...idle, chatMessageLoadStates: { old: "loading" } }),
    ).toBeNull();
  });

  it("only recognizes an explicit Agents window URL", () => {
    expect(
      parseAgentWindowChannel(new URL("http://localhost/?view=agents&agentWindow=abc-123")),
    ).toBe("abc-123");
    for (const query of [
      "",
      "?agentWindow=abc",
      "?view=agents",
      "?view=agents&agentWindow=../bad",
      "?target=open&type=directory&path=/workspace",
    ]) {
      expect(parseAgentWindowChannel(new URL(`http://localhost/${query}`))).toBeNull();
    }
  });
});

describe("Agents window drafts", () => {
  it("captures current text, attachments and context without sharing mutable references", () => {
    const unregister = registerAgentDraft("session", () => draft);
    const snapshot = captureAgentDrafts();
    expect(snapshot.session).toEqual(draft);
    snapshot.session.bufferIds.push("another");
    expect(captureAgentDrafts().session.bufferIds).toEqual(["editor-1"]);
    unregister();
  });

  it("keeps a draft when its composer unmounts and restores it only once", () => {
    const unregister = registerAgentDraft("session", () => draft);
    unregister();
    expect(takeAgentDraft("session")).toEqual(draft);
    expect(takeAgentDraft("session")).toBeUndefined();
  });

  it("does not let an old composer unregister its replacement", () => {
    const old = registerAgentDraft("session", () => draft);
    const current = registerAgentDraft("session", () => ({ ...draft, text: "Updated" }));
    old();
    expect(captureAgentDrafts().session.text).toBe("Updated");
    current();
  });

  it("replaces stale source drafts with the returned drafts, including empty text", () => {
    restoreAgentDrafts({ session: draft });
    restoreAgentDrafts({ session: { ...draft, text: "", images: [] } });
    expect(takeAgentDraft("session")).toEqual({ ...draft, text: "", images: [] });
  });

  it("merges a returned agent draft without losing drafts for other sessions", () => {
    restoreAgentDrafts({
      "agent-session:first": draft,
      "agent-session:second": { ...draft, text: "Still editing here" },
    });
    restoreAgentDrafts({ "agent-session:first": { ...draft, text: "", images: [] } }, true);

    expect(takeAgentDraft("agent-session:first")).toEqual({ ...draft, text: "", images: [] });
    expect(takeAgentDraft("agent-session:second")?.text).toBe("Still editing here");
  });
});
