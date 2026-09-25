// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  keepAgentHunk: vi.fn(),
  rejectAgentHunk: vi.fn(),
  keepAllAgentEdits: vi.fn(),
  rejectAllAgentEdits: vi.fn(),
  keepAgentFile: vi.fn(),
  rejectAgentFile: vi.fn(),
  openToolPath: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/agent-edits-service", () => mocks);
vi.mock("@/features/ai/lib/open-tool-location", () => ({ openToolPath: mocks.openToolPath }));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: (select: (state: { rootFolderPath: string }) => unknown) =>
    select({ rootFolderPath: "/repo" }),
}));

import { AgentEditsReview } from "../components/chat/agent-edits-review";
import { AgentEditsBar } from "../components/input/agent-edits-bar";
import { pickAgentEditsChatId, useAgentEditsStore } from "../stores/agent-edits.store";

const CHAT = "chat-1";

function buttons(label: string) {
  return [...document.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === label,
  );
}

describe("agent edits review", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    useAgentEditsStore.setState({
      reviewChatId: null,
      byChat: {
        [CHAT]: {
          "/repo/src/a.ts": {
            path: "/repo/src/a.ts",
            baseline: "a\nb\nc\nd\ne\nf",
            current: "A\nb\nc\nd\ne\nF",
            created: false,
            revision: 1,
          },
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("summarizes the changes above the composer and opens the review", () => {
    act(() => root.render(<AgentEditsBar chatId={CHAT} />));
    expect(container.textContent).toContain("1 file changed");
    expect(container.textContent).toContain("+2 -2");

    act(() => buttons("Review")[0].click());
    expect(useAgentEditsStore.getState().reviewChatId).toBe(CHAT);
  });

  it("lists each hunk with keep, reject and open", () => {
    useAgentEditsStore.setState({ reviewChatId: CHAT });
    act(() => root.render(<AgentEditsReview />));

    expect(document.body.textContent).toContain("src/a.ts");
    expect(buttons("Keep")).toHaveLength(2);

    act(() => buttons("Reject")[1].click());
    expect(mocks.rejectAgentHunk).toHaveBeenCalledWith(
      CHAT,
      "/repo/src/a.ts",
      expect.objectContaining({ currentStart: 5, currentLines: ["F"] }),
    );

    act(() => buttons("Line 6")[0].click());
    expect(mocks.openToolPath).toHaveBeenCalledWith("/repo/src/a.ts", 6);
    expect(useAgentEditsStore.getState().reviewChatId).toBeNull();
  });

  it("closes once nothing is left to review", () => {
    useAgentEditsStore.setState({ reviewChatId: CHAT });
    act(() => root.render(<AgentEditsReview />));
    act(() => useAgentEditsStore.getState().actions.setEntry(CHAT, "/repo/src/a.ts", null));

    expect(useAgentEditsStore.getState().reviewChatId).toBeNull();
  });
});

describe("pickAgentEditsChatId", () => {
  it("prefers the chat in view and falls back to the last chat with edits", () => {
    const entry = { path: "/a", baseline: "a", current: "b", created: false, revision: 1 };
    useAgentEditsStore.setState({ byChat: { one: { "/a": entry }, two: { "/a": entry } } });

    expect(pickAgentEditsChatId("one")).toBe("one");
    expect(pickAgentEditsChatId("idle")).toBe("two");
    expect(pickAgentEditsChatId(null)).toBe("two");
    useAgentEditsStore.setState({ byChat: {} });
    expect(pickAgentEditsChatId("one")).toBeNull();
  });
});
