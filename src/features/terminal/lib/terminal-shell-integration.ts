import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

export type TerminalCommandStatus = "running" | "success" | "failure";

export interface TerminalCommandRecord {
  id: number;
  promptMarker: IMarker;
  commandMarker: IMarker | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  status: TerminalCommandStatus;
}

export interface TerminalShellIntegrationOptions {
  now?: () => number;
  onCommandFinished?: (command: TerminalCommandRecord) => void;
  onCommandStarted?: (command: TerminalCommandRecord) => void;
}

const SHELL_INTEGRATION_OSC = 133;

function parseExitCode(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export class TerminalShellIntegration implements IDisposable {
  private readonly commands: TerminalCommandRecord[] = [];
  private readonly decorations = new Map<number, IDecoration>();
  private readonly oscHandler: IDisposable;
  private pending: TerminalCommandRecord | null = null;
  private nextId = 1;
  private disposed = false;

  constructor(
    private readonly terminal: Terminal,
    private readonly options: TerminalShellIntegrationOptions = {},
  ) {
    this.oscHandler = terminal.parser.registerOscHandler(SHELL_INTEGRATION_OSC, (payload) =>
      this.handleSequence(payload),
    );
  }

  get isActive(): boolean {
    return this.commands.length > 0 || this.pending !== null;
  }

  get currentCommand(): TerminalCommandRecord | null {
    const last = this.commands[this.commands.length - 1];
    return last?.status === "running" ? last : null;
  }

  getCommands(): readonly TerminalCommandRecord[] {
    return this.commands;
  }

  scrollToPreviousCommand(): boolean {
    const current = this.terminal.buffer.active.viewportY;
    const target = [...this.commands]
      .reverse()
      .find((command) => command.promptMarker.line >= 0 && command.promptMarker.line < current);
    if (!target) return false;
    this.scrollTo(target);
    return true;
  }

  scrollToNextCommand(): boolean {
    const current = this.terminal.buffer.active.viewportY;
    const target = this.commands.find(
      (command) => command.promptMarker.line >= 0 && command.promptMarker.line > current,
    );
    if (!target) {
      this.terminal.scrollToBottom();
      return false;
    }
    this.scrollTo(target);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.oscHandler.dispose();
    for (const decoration of this.decorations.values()) decoration.dispose();
    this.decorations.clear();
    for (const command of this.commands) {
      command.promptMarker.dispose();
      command.commandMarker?.dispose();
    }
    this.commands.length = 0;
    this.pending = null;
  }

  private scrollTo(command: TerminalCommandRecord) {
    this.terminal.scrollToLine(Math.max(0, command.promptMarker.line));
  }

  private handleSequence(payload: string): boolean {
    const [kind, ...rest] = payload.split(";");

    switch (kind) {
      case "A":
        this.startPrompt();
        return true;
      case "B":
        return true;
      case "C":
        this.startCommand();
        return true;
      case "D":
        this.finishCommand(parseExitCode(rest[0]));
        return true;
      default:
        return false;
    }
  }

  private startPrompt() {
    if (this.disposed) return;
    const marker = this.terminal.registerMarker(0);
    if (!marker) return;

    marker.onDispose(() => this.forgetMarker(marker));

    if (this.pending && this.pending.commandMarker === null) {
      this.pending.promptMarker.dispose();
      this.pending.promptMarker = marker;
      return;
    }

    this.pending = {
      id: this.nextId++,
      promptMarker: marker,
      commandMarker: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      status: "running",
    };
  }

  private startCommand() {
    if (this.disposed) return;
    const command = this.pending ?? this.createCommandWithoutPrompt();
    if (!command) return;

    this.pending = null;
    command.commandMarker = this.terminal.registerMarker(0) ?? null;
    command.startedAt = this.options.now?.() ?? Date.now();
    command.status = "running";
    this.commands.push(command);
    this.decorate(command);
    this.options.onCommandStarted?.(command);
  }

  private finishCommand(exitCode: number | null) {
    if (this.disposed) return;
    const command = this.currentCommand;
    if (!command) return;

    command.exitCode = exitCode;
    command.finishedAt = this.options.now?.() ?? Date.now();
    command.status = exitCode === null || exitCode === 0 ? "success" : "failure";
    this.decorate(command);
    this.options.onCommandFinished?.(command);
  }

  private createCommandWithoutPrompt(): TerminalCommandRecord | null {
    const marker = this.terminal.registerMarker(0);
    if (!marker) return null;
    marker.onDispose(() => this.forgetMarker(marker));
    return {
      id: this.nextId++,
      promptMarker: marker,
      commandMarker: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      status: "running",
    };
  }

  private decorate(command: TerminalCommandRecord) {
    this.decorations.get(command.id)?.dispose();
    if (command.promptMarker.isDisposed) return;

    const decoration = this.terminal.registerDecoration({
      marker: command.promptMarker,
      x: 0,
      width: 1,
      layer: "top",
      overviewRulerOptions:
        command.status === "failure"
          ? { color: "var(--destructive)", position: "left" }
          : undefined,
    });
    if (!decoration) return;

    decoration.onRender((element) => {
      element.classList.add("terminal-command-mark");
      element.dataset.commandStatus = command.status;
      element.title =
        command.status === "running"
          ? "Command running"
          : command.exitCode === null || command.exitCode === 0
            ? "Command succeeded"
            : `Command exited with code ${command.exitCode}`;
    });
    this.decorations.set(command.id, decoration);
  }

  private forgetMarker(marker: IMarker) {
    const index = this.commands.findIndex((command) => command.promptMarker === marker);
    if (index === -1) return;
    const [command] = this.commands.splice(index, 1);
    this.decorations.get(command.id)?.dispose();
    this.decorations.delete(command.id);
    command.commandMarker?.dispose();
  }
}
