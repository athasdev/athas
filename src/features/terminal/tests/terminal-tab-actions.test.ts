import type { IBufferLine, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { TerminalEmulatorHandle } from "../types/terminal.types";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(options: unknown, getContents: () => string) => Promise<string | null>>(),
  toast: vi.fn(),
}));
vi.mock("@/utils/file-dialogs", () => ({ saveTextFileWithDialog: mocks.save }));
vi.mock("@/utils/toast", () => ({ showToast: mocks.toast }));

import {
  getTerminalEmulator,
  registerTerminalEmulator,
} from "../services/terminal-emulator-registry";
import { clearTerminal, exportTerminalOutput } from "../services/terminal-tab-actions";
import { getTerminalBufferText, getTerminalExportFileName } from "../utils/terminal-buffer-text";

function bufferOf(rows: Array<{ text: string; isWrapped?: boolean }>) {
  return {
    length: rows.length,
    getLine: (index: number) => {
      const row = rows[index];
      if (!row) return undefined;
      return {
        isWrapped: row.isWrapped ?? false,
        translateToString: (trimRight?: boolean) => (trimRight ? row.text.trimEnd() : row.text),
      } as IBufferLine;
    },
  };
}

function createHandle(rows: Array<{ text: string; isWrapped?: boolean }> = []) {
  const terminal = { buffer: { active: bufferOf(rows) } } as unknown as Terminal;
  return {
    focus: vi.fn(),
    showSearch: vi.fn(),
    navigateCommand: vi.fn(),
    clear: vi.fn(),
    selectAll: vi.fn(),
    copyLastCommandOutput: vi.fn(),
    terminal,
  } satisfies TerminalEmulatorHandle;
}

const unregisters: Array<() => void> = [];
function register(sessionId: string, handle: TerminalEmulatorHandle) {
  unregisters.push(registerTerminalEmulator(sessionId, handle));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister();
});

describe("terminal buffer text", () => {
  it("joins soft-wrapped rows and drops trailing blank lines", () => {
    const text = getTerminalBufferText(
      bufferOf([
        { text: "$ echo hello   " },
        { text: "a very long line that " },
        { text: "wrapped", isWrapped: true },
        { text: "" },
        { text: "   " },
      ]),
    );
    expect(text).toBe("$ echo hello\na very long line that wrapped");
  });

  it("names the export after the terminal and date", () => {
    expect(getTerminalExportFileName("zsh: ~/app", new Date("2026-10-07T12:00:00Z"))).toBe(
      "zsh____app_2026-10-07.txt",
    );
    expect(getTerminalExportFileName("", new Date("2026-10-07T12:00:00Z"))).toBe(
      "terminal_2026-10-07.txt",
    );
  });
});

describe("terminal emulator registry", () => {
  it("only lets the current owner unregister a session", () => {
    const first = createHandle();
    const second = createHandle();
    const unregisterFirst = registerTerminalEmulator("session", first);
    register("session", second);
    unregisterFirst();
    expect(getTerminalEmulator("session")).toBe(second);
  });
});

describe("terminal tab actions", () => {
  it("clears the clicked tab rather than the active one", () => {
    const active = createHandle();
    const clicked = createHandle();
    register("active", active);
    register("background", clicked);

    expect(clearTerminal("background")).toBe(true);
    expect(clicked.clear).toHaveBeenCalledTimes(1);
    expect(active.clear).not.toHaveBeenCalled();
    expect(clearTerminal("missing")).toBe(false);
  });

  it("exports the clicked tab's buffer as plain text", async () => {
    register("active", createHandle([{ text: "active output" }]));
    register("background", createHandle([{ text: "$ ls" }, { text: "README.md" }]));
    mocks.save.mockResolvedValue("/tmp/out.txt");

    await expect(exportTerminalOutput("background", "zsh")).resolves.toBe("/tmp/out.txt");

    const [options, getContents] = mocks.save.mock.calls[0]!;
    expect(options).toMatchObject({ defaultPath: expect.stringMatching(/^zsh_.*\.txt$/) });
    expect(getContents()).toBe("$ ls\nREADME.md");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("does not open a save dialog for an empty or unknown terminal", async () => {
    register("empty", createHandle([{ text: "" }]));
    await expect(exportTerminalOutput("empty", "zsh")).resolves.toBeNull();
    await expect(exportTerminalOutput("missing", "zsh")).resolves.toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("reports a failed write", async () => {
    register("background", createHandle([{ text: "output" }]));
    mocks.save.mockRejectedValue(new Error("disk full"));
    await expect(exportTerminalOutput("background", "zsh")).resolves.toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", description: "disk full" }),
    );
  });
});
