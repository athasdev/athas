import { describe, expect, test } from "bun:test";
import { getNextQueuedMessageIndex, getQueuedMessageCounts } from "./message-queue";

describe("message queue helpers", () => {
  test("prioritizes steering messages before follow-up messages", () => {
    expect(
      getNextQueuedMessageIndex([
        {
          id: "1",
          content: "follow-up first",
          kind: "follow-up",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "2",
          content: "steer next",
          kind: "steering",
          timestamp: new Date("2026-01-01T00:00:01.000Z"),
        },
      ]),
    ).toBe(1);
  });

  test("falls back to the first follow-up message when no steering messages exist", () => {
    expect(
      getNextQueuedMessageIndex([
        {
          id: "1",
          content: "follow-up",
          kind: "follow-up",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(0);
  });

  test("counts steering and follow-up messages independently", () => {
    expect(
      getQueuedMessageCounts([
        {
          id: "1",
          content: "steer",
          kind: "steering",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "2",
          content: "follow",
          kind: "follow-up",
          timestamp: new Date("2026-01-01T00:00:01.000Z"),
        },
        {
          id: "3",
          content: "steer again",
          kind: "steering",
          timestamp: new Date("2026-01-01T00:00:02.000Z"),
        },
      ]),
    ).toEqual({
      steering: 2,
      followUp: 1,
      total: 3,
    });
  });
});
