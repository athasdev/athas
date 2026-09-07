import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { TerminalShellIntegration } from "../lib/terminal-shell-integration";

interface FakeTerminal {
  terminal: Terminal;
  emit: (payload: string) => boolean;
  scrolledTo: number[];
  decorations: Array<{ element: HTMLElement; disposed: boolean }>;
  setCursorLine: (line: number) => void;
  setViewportY: (line: number) => void;
  setLines: (lines: string[]) => void;
}

function createFakeTerminal(): FakeTerminal {
  let cursorLine = 0;
  let viewportY = 0;
  let lines: string[] = [];
  let oscHandler: ((payload: string) => boolean) | null = null;
  const scrolledTo: number[] = [];
  const decorations: Array<{ element: HTMLElement; disposed: boolean }> = [];

  const terminal = {
    buffer: {
      get active() {
        return {
          viewportY,
          baseY: 0,
          cursorY: cursorLine,
          length: lines.length,
          getLine: (line: number) =>
            line < lines.length ? { translateToString: () => lines[line] } : undefined,
        };
      },
    },
    parser: {
      registerOscHandler: (_ident: number, handler: (payload: string) => boolean) => {
        oscHandler = handler;
        return { dispose: () => undefined };
      },
    },
    registerMarker: (): IMarker => {
      const listeners = new Set<() => void>();
      const marker = {
        id: cursorLine,
        line: cursorLine,
        isDisposed: false,
        onDispose: (listener: () => void) => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
        dispose: () => {
          marker.isDisposed = true;
          for (const listener of listeners) listener();
        },
      };
      return marker as unknown as IMarker;
    },
    registerDecoration: (): IDecoration => {
      const element = {
        classList: { add: () => undefined },
        dataset: {} as Record<string, string>,
        title: "",
      } as unknown as HTMLElement;
      const entry = { element, disposed: false };
      decorations.push(entry);
      return {
        onRender: (listener: (element: HTMLElement) => void) => {
          listener(element);
          return { dispose: () => undefined };
        },
        dispose: () => {
          entry.disposed = true;
        },
      } as unknown as IDecoration;
    },
    scrollToLine: (line: number) => scrolledTo.push(line),
    scrollToBottom: () => scrolledTo.push(-1),
  } as unknown as Terminal;

  return {
    terminal,
    emit: (payload) => oscHandler?.(payload) ?? false,
    scrolledTo,
    decorations,
    setCursorLine: (line) => {
      cursorLine = line;
    },
    setViewportY: (line) => {
      viewportY = line;
    },
    setLines: (next) => {
      lines = next;
    },
  };
}

describe("terminal shell integration", () => {
  it("tracks prompts, commands, and exit codes from OSC 133", () => {
    const fake = createFakeTerminal();
    const finished = vi.fn();
    const now = vi.fn(() => 1_000);
    const integration = new TerminalShellIntegration(fake.terminal, {
      now,
      onCommandFinished: finished,
    });

    fake.setCursorLine(0);
    expect(fake.emit("A")).toBe(true);
    expect(fake.emit("B")).toBe(true);
    fake.setCursorLine(1);
    expect(fake.emit("C")).toBe(true);
    expect(integration.currentCommand?.status).toBe("running");

    now.mockReturnValue(4_500);
    fake.setCursorLine(5);
    expect(fake.emit("D;1")).toBe(true);

    expect(finished).toHaveBeenCalledTimes(1);
    expect(integration.getCommands()[0]).toMatchObject({
      status: "failure",
      exitCode: 1,
      startedAt: 1_000,
      finishedAt: 4_500,
    });
    expect(fake.decorations[fake.decorations.length - 1]?.element.dataset.commandStatus).toBe(
      "failure",
    );
    expect(fake.emit("Z")).toBe(false);
  });

  it("re-anchors the prompt marker when a prompt is redrawn without a command", () => {
    const fake = createFakeTerminal();
    const integration = new TerminalShellIntegration(fake.terminal);

    fake.setCursorLine(0);
    fake.emit("A");
    fake.setCursorLine(3);
    fake.emit("A");
    fake.setCursorLine(4);
    fake.emit("C");
    fake.emit("D;0");

    expect(integration.getCommands()).toHaveLength(1);
    expect(integration.getCommands()[0].promptMarker.line).toBe(3);
    expect(integration.getCommands()[0].status).toBe("success");
  });

  it("extracts the output printed between a command and the next prompt", () => {
    const fake = createFakeTerminal();
    const integration = new TerminalShellIntegration(fake.terminal);
    fake.setLines(["$ ls", "a.txt", "b.txt", "", "$ ", ""]);

    expect(integration.getLastCommandOutput()).toBeNull();

    fake.setCursorLine(0);
    fake.emit("A");
    fake.emit("B");
    fake.setCursorLine(1);
    fake.emit("C");
    fake.setCursorLine(3);
    expect(integration.getLastCommandOutput()).toBe("a.txt\nb.txt");

    fake.emit("D;0");
    fake.setCursorLine(4);
    fake.emit("A");
    expect(integration.getLastCommandOutput()).toBe("a.txt\nb.txt");
  });

  it("scrolls between prompts relative to the viewport", () => {
    const fake = createFakeTerminal();
    const integration = new TerminalShellIntegration(fake.terminal);

    for (const line of [0, 10, 20]) {
      fake.setCursorLine(line);
      fake.emit("A");
      fake.setCursorLine(line + 1);
      fake.emit("C");
      fake.emit("D;0");
    }

    fake.setViewportY(20);
    expect(integration.scrollToPreviousCommand()).toBe(true);
    expect(fake.scrolledTo[fake.scrolledTo.length - 1]).toBe(10);

    fake.setViewportY(10);
    expect(integration.scrollToNextCommand()).toBe(true);
    expect(fake.scrolledTo[fake.scrolledTo.length - 1]).toBe(20);

    fake.setViewportY(20);
    expect(integration.scrollToNextCommand()).toBe(false);
    expect(fake.scrolledTo[fake.scrolledTo.length - 1]).toBe(-1);

    fake.setViewportY(0);
    expect(integration.scrollToPreviousCommand()).toBe(false);
  });

  it("drops commands whose markers fall out of the scrollback and cleans up on dispose", () => {
    const fake = createFakeTerminal();
    const integration = new TerminalShellIntegration(fake.terminal);

    fake.setCursorLine(0);
    fake.emit("A");
    fake.emit("C");
    fake.emit("D;0");
    const [command] = integration.getCommands();
    command.promptMarker.dispose();
    expect(integration.getCommands()).toHaveLength(0);
    expect(fake.decorations.every((decoration) => decoration.disposed)).toBe(true);

    fake.setCursorLine(2);
    fake.emit("A");
    fake.emit("C");
    integration.dispose();
    expect(integration.getCommands()).toHaveLength(0);
    expect(integration.isActive).toBe(false);
  });
});
