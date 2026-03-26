import { describe, expect, test } from "bun:test";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import {
  filterTranscriptAcpEvents,
  getTranscriptAcpEventGroupLabel,
} from "./chat-transcript-events";

const createEvent = (
  kind: ChatAcpEvent["kind"],
  label?: string,
  state: ChatAcpEvent["state"] = "info",
): ChatAcpEvent => ({
  id: `${kind}-${label ?? kind}`,
  kind,
  label: label ?? kind,
  state,
  timestamp: new Date("2026-03-27T00:00:00.000Z"),
});

describe("chat transcript events", () => {
  test("filters out low-signal session activity events from the transcript", () => {
    const events = [
      createEvent("mode", "Mode changed"),
      createEvent("thinking", "Thinking", "running"),
      createEvent("status", "Idle"),
      createEvent("permission", "Permission requested"),
      createEvent("tool", "read_file", "running"),
      createEvent("plan", "Plan updated"),
      createEvent("error", "Agent error", "error"),
    ];

    expect(filterTranscriptAcpEvents(events).map((event) => event.kind)).toEqual([
      "tool",
      "plan",
      "error",
    ]);
  });

  test("labels error groups explicitly instead of falling back to session activity", () => {
    const events = [createEvent("error", "Agent error", "error")];

    expect(getTranscriptAcpEventGroupLabel(events)).toBe("Agent error");
  });
});
