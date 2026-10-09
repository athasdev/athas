// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ saveChatToDb: vi.fn() }));

vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  saveChatToDb: mocks.saveChatToDb,
}));

import { performMigrationIfNeeded } from "../lib/chat-migration";
import type { Chat } from "../types/ai-chat.types";

const LEGACY_KEY = "athas-ai-chat-v4";
const STATUS_KEY = "athas-chat-migration-status";

function legacyChat(id: string) {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2025-01-01T00:00:00.000Z",
    lastMessageAt: "2025-01-02T00:00:00.000Z",
    messages: [
      {
        id: `${id}-m1`,
        role: "assistant",
        content: "Done",
        timestamp: "2025-01-02T00:00:00.000Z",
        toolCalls: [{ name: "read_file", timestamp: "2025-01-02T00:00:01.000Z" }],
      },
      { id: `${id}-m2`, role: "user", content: "Thanks", timestamp: "2025-01-02T00:01:00.000Z" },
    ],
  };
}

function status() {
  return JSON.parse(localStorage.getItem(STATUS_KEY) ?? "null");
}

beforeEach(() => {
  localStorage.clear();
  mocks.saveChatToDb.mockReset();
  mocks.saveChatToDb.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("legacy chat migration", () => {
  it("skips work once a migration has completed", async () => {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ completed: true }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ state: { chats: [legacyChat("a")] } }));

    expect(await performMigrationIfNeeded()).toBe(true);
    expect(mocks.saveChatToDb).not.toHaveBeenCalled();
  });

  it("records an empty migration when there is no legacy data", async () => {
    expect(await performMigrationIfNeeded()).toBe(true);
    expect(status()).toMatchObject({ completed: true, migratedCount: 0 });

    localStorage.clear();
    localStorage.setItem(LEGACY_KEY, "{not json");
    expect(await performMigrationIfNeeded()).toBe(true);
    expect(status()).toMatchObject({ completed: true, migratedCount: 0 });
  });

  it("copies legacy chats into the database with real dates and tool call ids", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ state: { chats: [legacyChat("a"), legacyChat("b")] }, version: 4 }),
    );

    expect(await performMigrationIfNeeded()).toBe(true);

    expect(mocks.saveChatToDb).toHaveBeenCalledTimes(2);
    const saved = mocks.saveChatToDb.mock.calls[0][0] as Chat;
    expect(saved.id).toBe("a");
    expect(saved.agentId).toBe("custom");
    expect(saved.createdAt).toEqual(new Date("2025-01-01T00:00:00.000Z"));
    expect(saved.messages[0].timestamp).toBeInstanceOf(Date);
    expect(saved.messages[0].toolCalls?.[0].id).toEqual(expect.any(String));
    expect(saved.messages[0].toolCalls?.[0].timestamp).toEqual(
      new Date("2025-01-02T00:00:01.000Z"),
    );
    expect(saved.messages[1].toolCalls).toBeUndefined();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(status()).toMatchObject({ completed: true, migratedCount: 2 });
  });

  it("keeps the legacy data and retries later when a chat fails to save", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ state: { chats: [legacyChat("a"), legacyChat("b")] } }),
    );
    mocks.saveChatToDb
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));

    expect(await performMigrationIfNeeded()).toBe(false);

    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(status()).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Failed to migrate chat b: Error: disk full");
  });
});
