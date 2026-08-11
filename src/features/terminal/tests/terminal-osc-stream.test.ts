import { describe, expect, it } from "vitest";
import { TerminalOscStream } from "@/features/terminal/utils/terminal-osc-stream";

describe("TerminalOscStream", () => {
  it("parses OSC 0 and OSC 2 titles with BEL and ST terminators", () => {
    const stream = new TerminalOscStream();

    expect(stream.feed("\u001b]2;bun dev\u0007")).toEqual({ title: "bun dev" });
    expect(stream.feed("\u001b]0;vitest\u001b\\")).toEqual({ title: "vitest" });
  });

  it("parses sequences split across every byte boundary", () => {
    const bytes = new TextEncoder().encode("\u001b]2;çalıştır\u0007");
    const decoder = new TextDecoder();
    const stream = new TerminalOscStream();
    let title: string | undefined;

    for (const byte of bytes) {
      const updates = stream.feed(decoder.decode(Uint8Array.of(byte), { stream: true }));
      title = updates.title ?? title;
    }

    expect(title).toBe("çalıştır");
  });

  it("parses OSC 7 directories with either terminator", () => {
    const stream = new TerminalOscStream();

    expect(stream.feed("\u001b]7;file://host/Users/mehmet/My%20Project\u0007")).toEqual({
      currentDirectory: "/Users/mehmet/My Project",
    });
    expect(stream.feed("\u001b]7;file:///tmp/project\u001b\\")).toEqual({
      currentDirectory: "/tmp/project",
    });
  });

  it("uses the last complete value when a chunk contains multiple sequences", () => {
    const stream = new TerminalOscStream();

    expect(stream.feed("\u001b]2;old\u0007text\u001b]2;new\u0007")).toEqual({ title: "new" });
  });

  it("recovers from an unterminated title before the next OSC sequence", () => {
    const stream = new TerminalOscStream();
    const leakedPrompt =
      "\u001b]2;broken\u001b[0m\u001b[27m\u001b[01;32m➜ athas\u001b[00m" + "\u001b]2;ls\u0007";

    expect(stream.feed(leakedPrompt)).toEqual({ title: "ls" });
  });

  it("supports C1 OSC and ST while ignoring icon-only titles", () => {
    const stream = new TerminalOscStream();

    expect(stream.feed("\u009d1;icon\u009c")).toEqual({});
    expect(stream.feed("\u009d2;main\u009c")).toEqual({ title: "main" });
  });

  it("clears empty titles and rejects control-sequence payloads", () => {
    const stream = new TerminalOscStream();

    expect(stream.feed("\u001b]2;\u0007")).toEqual({ title: "" });
    expect(stream.feed("\u001b]2;[0mbroken\u0007")).toEqual({ title: "" });
  });
});
