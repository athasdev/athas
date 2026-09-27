import { describe, expect, it } from "vite-plus/test";
import {
  type AgentFollowClock,
  canFollowAgent,
  createLatestThrottle,
  interruptsAgentFollow,
  isSameAgentFollowTarget,
  pickAgentFollowPaneId,
  pickAgentFollowTarget,
} from "@/features/ai/lib/agent-follow";
import { selectIsFollowingAgent } from "@/features/ai/stores/agent-follow.store";

function createFakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: AgentFollowClock = {
    now: () => now,
    setTimeout: (callback, delay) => {
      nextId += 1;
      timers.set(nextId, { at: now + delay, callback });
      return nextId;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers].sort(([, a], [, b]) => a.at - b.at)) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  return { clock, advance, pendingTimers: () => timers.size };
}

describe("agent follow throttle", () => {
  it("jumps at once, then at most once per interval with the latest location", () => {
    const { clock, advance } = createFakeClock();
    const runs: string[] = [];
    const throttle = createLatestThrottle<string>((value) => runs.push(value), 300, clock);

    throttle.push("a.ts");
    expect(runs).toEqual(["a.ts"]);

    advance(100);
    throttle.push("b.ts");
    throttle.push("c.ts");
    expect(runs).toEqual(["a.ts"]);

    advance(199);
    expect(runs).toEqual(["a.ts"]);
    advance(1);
    expect(runs).toEqual(["a.ts", "c.ts"]);

    // A quiet interval later the next location goes through straight away again.
    advance(300);
    throttle.push("d.ts");
    expect(runs).toEqual(["a.ts", "c.ts", "d.ts"]);
  });

  it("keeps the spacing after a delayed jump", () => {
    const { clock, advance } = createFakeClock();
    const runs: string[] = [];
    const throttle = createLatestThrottle<string>((value) => runs.push(value), 300, clock);

    throttle.push("a.ts");
    advance(50);
    throttle.push("b.ts");
    advance(250);
    expect(runs).toEqual(["a.ts", "b.ts"]);

    advance(10);
    throttle.push("c.ts");
    expect(runs).toEqual(["a.ts", "b.ts"]);
    advance(290);
    expect(runs).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("drops a waiting jump when cancelled", () => {
    const { clock, advance, pendingTimers } = createFakeClock();
    const runs: string[] = [];
    const throttle = createLatestThrottle<string>((value) => runs.push(value), 300, clock);

    throttle.push("a.ts");
    throttle.push("b.ts");
    expect(pendingTimers()).toBe(1);
    throttle.cancel();
    expect(pendingTimers()).toBe(0);
    advance(1_000);
    expect(runs).toEqual(["a.ts"]);
  });
});

describe("agent follow eligibility", () => {
  const eligible = { following: true, running: true, visible: true, detached: false };

  it("follows only the visible, running, attached chat that has following on", () => {
    expect(canFollowAgent(eligible)).toBe(true);
    expect(canFollowAgent({ ...eligible, following: false })).toBe(false);
    expect(canFollowAgent({ ...eligible, running: false })).toBe(false);
    expect(canFollowAgent({ ...eligible, visible: false })).toBe(false);
    expect(canFollowAgent({ ...eligible, detached: true })).toBe(false);
  });

  it("uses the setting for chats nobody toggled", () => {
    expect(selectIsFollowingAgent({}, "chat-1", false)).toBe(false);
    expect(selectIsFollowingAgent({}, "chat-1", true)).toBe(true);
    expect(selectIsFollowingAgent({ "chat-1": false }, "chat-1", true)).toBe(false);
    expect(selectIsFollowingAgent({ "chat-1": true }, "chat-1", false)).toBe(true);
    expect(selectIsFollowingAgent({}, null, true)).toBe(false);
  });

  it("uses the toggle saved with the chat until it is toggled again", () => {
    expect(selectIsFollowingAgent({}, "chat-1", false, true)).toBe(true);
    expect(selectIsFollowingAgent({}, "chat-1", true, false)).toBe(false);
    expect(selectIsFollowingAgent({ "chat-1": false }, "chat-1", true, true)).toBe(false);
  });
});

describe("agent follow interruption", () => {
  const input = {
    following: true,
    running: true,
    trusted: true,
    targetPaneId: "editor-pane",
    chatPaneId: "chat-pane",
  };

  it("stops when the user clicks, types or scrolls in another pane", () => {
    expect(interruptsAgentFollow(input)).toBe(true);
  });

  it("ignores input in the chat's pane, outside panes, and from scripts", () => {
    expect(interruptsAgentFollow({ ...input, targetPaneId: "chat-pane" })).toBe(false);
    expect(interruptsAgentFollow({ ...input, targetPaneId: null })).toBe(false);
    expect(interruptsAgentFollow({ ...input, trusted: false })).toBe(false);
  });

  it("only applies while following a running turn", () => {
    expect(interruptsAgentFollow({ ...input, following: false })).toBe(false);
    expect(interruptsAgentFollow({ ...input, running: false })).toBe(false);
  });
});

describe("agent follow targets", () => {
  it("follows the last reported location that has a path", () => {
    expect(
      pickAgentFollowTarget([
        { path: "src/a.ts", line: 3 },
        { path: "src/b.ts", line: 9 },
        { path: "" },
      ]),
    ).toEqual({ path: "src/b.ts", line: 9 });
    expect(pickAgentFollowTarget([{ path: "src/a.ts", line: 0 }])).toEqual({
      path: "src/a.ts",
      line: null,
    });
    expect(pickAgentFollowTarget([])).toBeNull();
    expect(pickAgentFollowTarget(null)).toBeNull();
  });

  it("compares targets by path and line", () => {
    expect(isSameAgentFollowTarget({ path: "a", line: 1 }, { path: "a", line: 1 })).toBe(true);
    expect(isSameAgentFollowTarget({ path: "a", line: 1 }, { path: "a", line: 2 })).toBe(false);
    expect(isSameAgentFollowTarget(null, { path: "a", line: 1 })).toBe(false);
  });
});

describe("agent follow pane", () => {
  const panes = [
    { id: "chat", bufferIds: ["agent"] },
    { id: "left", bufferIds: ["readme"] },
    { id: "right", bufferIds: ["main"] },
    { id: "locked", bufferIds: ["notes"], locked: true },
  ];

  it("never picks the chat's own pane or a locked pane", () => {
    expect(
      pickAgentFollowPaneId({
        panes,
        chatPaneId: "chat",
        bufferId: "notes",
        mostRecentActivePaneIds: ["chat", "locked"],
      }),
    ).toBe("left");
  });

  it("prefers a pane already showing the file, then the most recently used one", () => {
    expect(
      pickAgentFollowPaneId({
        panes,
        chatPaneId: "chat",
        bufferId: "main",
        mostRecentActivePaneIds: ["left"],
      }),
    ).toBe("right");
    expect(
      pickAgentFollowPaneId({
        panes,
        chatPaneId: "chat",
        bufferId: null,
        mostRecentActivePaneIds: ["chat", "right", "left"],
      }),
    ).toBe("right");
  });

  it("returns null when the chat is the only usable pane", () => {
    expect(
      pickAgentFollowPaneId({
        panes: [panes[0], panes[3]],
        chatPaneId: "chat",
        bufferId: null,
        mostRecentActivePaneIds: [],
      }),
    ).toBeNull();
  });
});
