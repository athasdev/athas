// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { emitAppEvent, onAppEvent, useAppEvent } from "../app-events";

const unsubscribers: Array<() => void> = [];

function subscribe(...args: Parameters<typeof onAppEvent<"terminal:activate-tab">>) {
  unsubscribers.push(onAppEvent(...args));
}

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  vi.unstubAllGlobals();
});

describe("app events", () => {
  it("delivers the payload synchronously in subscription order", () => {
    const calls: string[] = [];
    subscribe("terminal:activate-tab", (index) => calls.push(`first:${index}`));
    subscribe("terminal:activate-tab", (index) => calls.push(`second:${index}`));

    emitAppEvent("terminal:activate-tab", 2);
    calls.push("after");

    expect(calls).toEqual(["first:2", "second:2", "after"]);
  });

  it("stops delivering once unsubscribed and ignores duplicate subscriptions", () => {
    const handler = vi.fn();
    const unsubscribe = onAppEvent("terminal:activate-tab", handler);
    onAppEvent("terminal:activate-tab", handler);

    emitAppEvent("terminal:activate-tab", 1);
    unsubscribe();
    emitAppEvent("terminal:activate-tab", 1);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("skips handlers removed during delivery and defers handlers added during it", () => {
    const late = vi.fn();
    const removed = vi.fn();
    let unsubscribeRemoved = () => {};
    subscribe("terminal:activate-tab", () => {
      unsubscribeRemoved();
      subscribe("terminal:activate-tab", late);
    });
    unsubscribeRemoved = onAppEvent("terminal:activate-tab", removed);

    emitAppEvent("terminal:activate-tab", 0);
    expect(removed).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();

    emitAppEvent("terminal:activate-tab", 0);
    expect(late).toHaveBeenCalledOnce();
  });

  it("reports a throwing handler and still runs the rest", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("listener failed");
    const next = vi.fn();
    subscribe("terminal:activate-tab", () => {
      throw failure;
    });
    subscribe("terminal:activate-tab", next);

    expect(() => emitAppEvent("terminal:activate-tab", 3)).not.toThrow();
    expect(reportError).toHaveBeenCalledWith(failure);
    expect(next).toHaveBeenCalledWith(3);
  });

  it("keeps one subscription per mounted hook and calls its latest handler", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const received: string[] = [];
    let rerender = () => {};

    function Listener() {
      const [label, setLabel] = useState("before");
      rerender = () => setLabel("after");
      useAppEvent("ai:open-agent-sessions", (agentId) => received.push(`${label}:${agentId}`));
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Listener />));
    emitAppEvent("ai:open-agent-sessions", "a");
    await act(async () => rerender());
    emitAppEvent("ai:open-agent-sessions", "b");
    await act(async () => root.unmount());
    emitAppEvent("ai:open-agent-sessions", "c");

    expect(received).toEqual(["before:a", "after:b"]);
  });
});
