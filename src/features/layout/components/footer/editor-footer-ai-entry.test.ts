import { describe, expect, test, vi } from "bun:test";
import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
import { toggleHarnessFromAiChatToggle } from "./editor-footer-ai-entry";

describe("toggleHarnessFromAiChatToggle", () => {
  test("opens the default Harness session when requested from the closed state", () => {
    const openAgentBuffer = vi.fn();
    const closeBuffer = vi.fn();

    toggleHarnessFromAiChatToggle(null, openAgentBuffer, closeBuffer, true);

    expect(openAgentBuffer).toHaveBeenCalledWith(DEFAULT_HARNESS_SESSION_KEY);
    expect(closeBuffer).not.toHaveBeenCalled();
  });

  test("opens the default Harness session when toggled from a non-Harness tab", () => {
    const openAgentBuffer = vi.fn();
    const closeBuffer = vi.fn();

    toggleHarnessFromAiChatToggle(
      { id: "buffer-file-1", isAgent: false },
      openAgentBuffer,
      closeBuffer,
    );

    expect(openAgentBuffer).toHaveBeenCalledWith(DEFAULT_HARNESS_SESSION_KEY);
    expect(closeBuffer).not.toHaveBeenCalled();
  });

  test("does nothing when asked to close while no Harness buffer is active", () => {
    const openAgentBuffer = vi.fn();
    const closeBuffer = vi.fn();

    toggleHarnessFromAiChatToggle(null, openAgentBuffer, closeBuffer, false);

    expect(openAgentBuffer).not.toHaveBeenCalled();
    expect(closeBuffer).not.toHaveBeenCalled();
  });

  test("closes the active Harness buffer when toggled while Harness is focused", () => {
    const openAgentBuffer = vi.fn();
    const closeBuffer = vi.fn();

    toggleHarnessFromAiChatToggle(
      { id: "agent-buffer-1", isAgent: true },
      openAgentBuffer,
      closeBuffer,
      false,
    );

    expect(closeBuffer).toHaveBeenCalledWith("agent-buffer-1");
    expect(openAgentBuffer).not.toHaveBeenCalled();
  });
});
