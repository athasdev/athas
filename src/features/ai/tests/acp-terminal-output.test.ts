import { describe, expect, it } from "vite-plus/test";
import {
  appendAcpTerminalOutput,
  describeAcpTerminalExit,
  formatAcpTerminalText,
  withAcpTerminalSnapshot,
} from "@/features/ai/lib/acp-terminal-output";
import type { Message } from "@/features/ai/types/ai-chat.types";

const ESC = String.fromCharCode(27);

describe("ACP terminal output", () => {
  it("keeps the newest output within the display limit", () => {
    const start = { output: "", truncated: false, exit: null };
    const once = appendAcpTerminalOutput(start, "hello ", 8);
    expect(once).toEqual({ output: "hello ", truncated: false, exit: null });
    expect(appendAcpTerminalOutput(once, "world", 8)).toEqual({
      output: "lo world",
      truncated: true,
      exit: null,
    });
  });

  it("shows terminal output as plain text", () => {
    expect(
      formatAcpTerminalText(
        `${ESC}]0;title${String.fromCharCode(7)}${ESC}[32mok${ESC}[0m\r\n10%\r50%\r100%\ndone\n`,
      ),
    ).toBe("ok\n100%\ndone\n");
  });

  it("says how the command ended", () => {
    expect(describeAcpTerminalExit(null)).toBeNull();
    expect(describeAcpTerminalExit({ exitCode: 0, signal: null })).toBe("Exited with code 0");
    expect(describeAcpTerminalExit({ exitCode: null, signal: "Killed" })).toBe(
      "Ended by signal Killed",
    );
    expect(describeAcpTerminalExit({ exitCode: 1, signal: "released" })).toBe(
      "Stopped when the agent released the terminal",
    );
  });

  it("keeps the final output on the tool call that shows the terminal", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        content: "",
        timestamp: new Date(0),
        toolCalls: [
          { id: "read", name: "Read", input: {}, timestamp: new Date(0) },
          {
            id: "run",
            name: "Bash",
            input: {},
            output: [{ type: "terminal", terminalId: "term-1" }],
            timestamp: new Date(0),
          },
        ],
      },
    ];
    const snapshot = { output: "ok\n", truncated: false, exit: { exitCode: 0, signal: null } };

    const updated = withAcpTerminalSnapshot(messages, "term-1", snapshot);

    expect(updated?.messageId).toBe("m1");
    expect(updated?.toolCalls[1].terminals).toEqual({ "term-1": snapshot });
    expect(updated?.toolCalls[0]).toBe(messages[0].toolCalls?.[0]);
    expect(withAcpTerminalSnapshot(messages, "other", snapshot)).toBeNull();
  });
});
