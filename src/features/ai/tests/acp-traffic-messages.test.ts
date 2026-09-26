import { describe, expect, it } from "vite-plus/test";
import {
  appendTrafficEntries,
  buildTrafficMessages,
  filterTrafficMessages,
  formatTrafficMessages,
  parseTrafficEntry,
  summarizeInitialize,
  trafficSessionIds,
} from "@/features/ai/acp-inspector/lib/acp-traffic-messages";
import type {
  AcpTrafficDirection,
  AcpTrafficEntry,
} from "@/features/ai/acp-inspector/types/acp-traffic.types";

let nextSeq = 0;

function entry(
  direction: AcpTrafficDirection,
  message: unknown,
  timestampMs = 1000,
  extra: Partial<AcpTrafficEntry> = {},
): AcpTrafficEntry {
  const line = typeof message === "string" ? message : JSON.stringify(message);
  return {
    seq: nextSeq++,
    timestampMs,
    direction,
    line,
    truncated: false,
    originalBytes: line.length,
    ...extra,
  };
}

describe("ACP traffic messages", () => {
  it("classifies requests, responses, notifications and stderr", () => {
    const kinds = [
      entry("out", { jsonrpc: "2.0", id: 1, method: "session/new", params: {} }),
      entry("in", { jsonrpc: "2.0", id: 1, result: { sessionId: "s1" } }),
      entry("in", { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1" } }),
      entry("stderr", "debug: ready"),
      entry("in", "not json"),
    ].flatMap(parseTrafficEntry);

    expect(kinds.map((message) => message.kind)).toEqual([
      "request",
      "response",
      "notification",
      "stderr",
      "unknown",
    ]);
    expect(kinds[2].sessionId).toBe("s1");
  });

  it("splits a batch line into its messages", () => {
    const messages = parseTrafficEntry(
      entry("in", [
        { jsonrpc: "2.0", method: "a" },
        { jsonrpc: "2.0", method: "b" },
      ]),
    );

    expect(messages.map((message) => message.method)).toEqual(["a", "b"]);
    expect(new Set(messages.map((message) => message.key)).size).toBe(2);
  });

  it("uses the method and id Rust kept for a truncated line", () => {
    const [message] = parseTrafficEntry(
      entry("in", '{"jsonrpc":"2.0","id":4,"method":"fs/write_te', 1000, {
        truncated: true,
        method: "fs/write_text_file",
        id: 4,
      }),
    );

    expect(message.kind).toBe("request");
    expect(message.method).toBe("fs/write_text_file");
    expect(message.id).toBe("4");
  });

  it("pairs responses with requests from the other side and measures latency", () => {
    const messages = buildTrafficMessages([
      entry("out", { id: 0, method: "session/prompt", params: { sessionId: "s1" } }, 1000),
      entry("in", { id: 0, method: "session/request_permission", params: {} }, 1100),
      entry("out", { id: 0, result: { outcome: "selected" } }, 1300),
      entry("in", { id: 0, result: { stopReason: "end_turn" } }, 1600),
    ]);

    const [prompt, permission, permissionReply, promptReply] = messages;
    expect(permissionReply.partnerKey).toBe(permission.key);
    expect(permissionReply.method).toBe("session/request_permission");
    expect(permissionReply.latencyMs).toBe(200);
    expect(promptReply.partnerKey).toBe(prompt.key);
    expect(promptReply.method).toBe("session/prompt");
    expect(promptReply.sessionId).toBe("s1");
    expect(prompt.latencyMs).toBe(600);
  });

  it("leaves requests without a response unpaired", () => {
    const [request] = buildTrafficMessages([entry("out", { id: "a", method: "initialize" })]);

    expect(request.partnerKey).toBeNull();
    expect(request.latencyMs).toBeNull();
  });

  it("marks error responses", () => {
    const [, response] = buildTrafficMessages([
      entry("out", { id: 2, method: "session/load" }),
      entry("in", { id: 2, error: { code: -32601, message: "Method not found" } }),
    ]);

    expect(response.isError).toBe(true);
    expect(response.method).toBe("session/load");
  });

  it("filters by method, direction and session", () => {
    const messages = buildTrafficMessages([
      entry("out", { id: 1, method: "session/prompt", params: { sessionId: "s1" } }),
      entry("in", { method: "session/update", params: { sessionId: "s2" } }),
      entry("stderr", "Warning: slow start"),
    ]);
    const all = { query: "", direction: "all" as const, sessionId: null };

    expect(filterTrafficMessages(messages, { ...all, query: "PROMPT" })).toHaveLength(1);
    expect(filterTrafficMessages(messages, { ...all, query: "slow" })).toHaveLength(1);
    expect(filterTrafficMessages(messages, { ...all, direction: "in" })).toHaveLength(1);
    expect(filterTrafficMessages(messages, { ...all, sessionId: "s2" })[0].method).toBe(
      "session/update",
    );
    expect(trafficSessionIds(messages)).toEqual(["s1", "s2"]);
  });

  it("keeps the newest entries and ignores ones it already has", () => {
    const first = [entry("stderr", "a"), entry("stderr", "b")];
    const later = [first[1], entry("stderr", "c"), entry("stderr", "d")];

    const merged = appendTrafficEntries(first, later, 3);

    expect(merged.map((item) => item.line)).toEqual(["b", "c", "d"]);
  });

  it("formats messages for copying", () => {
    const text = formatTrafficMessages(
      buildTrafficMessages([entry("out", { id: 1, method: "initialize" }, 0)]),
    );

    expect(text).toContain("client -> agent request initialize #1");
    expect(text).toContain('"method": "initialize"');
  });

  it("summarizes the initialize exchange", () => {
    const summary = summarizeInitialize({
      request: {
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "athas" },
          clientCapabilities: { terminal: true },
        },
      },
      response: {
        id: 0,
        result: {
          protocolVersion: 1,
          agentInfo: { name: "agent" },
          agentCapabilities: { loadSession: true },
          authMethods: [{ id: "login" }],
        },
      },
    });

    expect(summary.clientCapabilities).toEqual({ terminal: true });
    expect(summary.agentCapabilities).toEqual({ loadSession: true });
    expect(summary.authMethods).toEqual([{ id: "login" }]);
    expect(summary.agentInfo).toEqual({ name: "agent" });
    expect(summary.error).toBeNull();
  });
});
