import { Prec, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { CodeMirror, getCM, Vim, vim } from "@replit/codemirror-vim";
import type { VimMode } from "@/features/vim/stores/vim.store";

type HistoryDirection = "undo" | "redo";
type HistoryHandler = (direction: HistoryDirection) => boolean;

/** The Athas buffer history of each editor running vim, so `u`, `<C-r>`, `:undo` use it. */
const historyHandlers = new WeakMap<EditorView, HistoryHandler>();

export function setVimHistoryHandler(view: EditorView, handler: HistoryHandler | null): void {
  if (handler) historyHandlers.set(view, handler);
  else historyHandlers.delete(view);
}

const defaultUndo = CodeMirror.commands.undo;
const defaultRedo = CodeMirror.commands.redo;

function runHistory(cm: CodeMirror, direction: HistoryDirection): void {
  const handler = historyHandlers.get(cm.cm6);
  if (handler) {
    handler(direction);
    return;
  }
  (direction === "undo" ? defaultUndo : defaultRedo)(cm);
}

let historyCommandsInstalled = false;
let exCommandsRegistration: Promise<void> | null = null;

/**
 * Routes vim's undo and redo through the Athas buffer history and registers the Athas ex
 * commands (`:w`, `:q`, `:e`, ...). Vim's command tables are global, so this runs once.
 */
export function registerAthasVimCommands(): Promise<void> {
  if (!historyCommandsInstalled) {
    historyCommandsInstalled = true;
    CodeMirror.commands.undo = (cm) => runHistory(cm, "undo");
    CodeMirror.commands.redo = (cm) => runHistory(cm, "redo");
    Vim.defineEx("undo", "u", (cm) => runHistory(cm, "undo"));
    Vim.defineEx("redo", "red", (cm) => runHistory(cm, "redo"));
  }

  exCommandsRegistration ??= import("@/features/vim/stores/vim-commands").then(
    ({ parseAndExecuteVimCommand, vimCommands }) => {
      for (const command of vimCommands) {
        for (const name of [command.name, ...(command.aliases ?? [])]) {
          Vim.defineEx(name, name, (_cm, params) => {
            void parseAndExecuteVimCommand(toAthasExInput(name, params.argString));
          });
        }
      }
    },
  );
  return exCommandsRegistration;
}

/**
 * The command line handed to the Athas vim command parser. Vim reads `:q!` as `q` with the
 * argument `!`, so a leading bang is joined back onto the name.
 */
export function toAthasExInput(name: string, argString?: string): string {
  const args = (argString ?? "").trim();
  if (!args) return name;
  if (args.startsWith("!")) {
    const rest = args.slice(1).trim();
    return rest ? `${name}! ${rest}` : `${name}!`;
  }
  return `${name} ${args}`;
}

export function toVimStoreMode(mode: string | undefined): VimMode {
  if (mode === "insert" || mode === "replace") return "insert";
  if (mode === "visual") return "visual";
  return "normal";
}

/** The vim mode an editor is in right now, or null when vim is not running in it. */
export function getVimMode(view: EditorView): VimMode | null {
  const vimState = getCM(view)?.state.vim;
  if (!vimState) return null;
  if (vimState.insertMode) return "insert";
  if (vimState.visualMode) return "visual";
  return "normal";
}

/**
 * Vim keybindings ahead of every other keymap, without vim's own status line (Athas shows the
 * mode in its status bar; the panel only appears for `:` commands and messages), reporting
 * mode changes to `onModeChange`.
 */
export function athasVim(onModeChange: (mode: VimMode) => void): Extension {
  const modeListener = ViewPlugin.fromClass(
    class {
      private cm: CodeMirror | null = null;
      private readonly handleModeChange = (event: { mode?: string }) =>
        onModeChange(toVimStoreMode(event.mode));

      constructor(view: EditorView) {
        this.attach(view);
      }

      update(update: { view: EditorView }) {
        if (!this.cm) this.attach(update.view);
      }

      private attach(view: EditorView) {
        this.cm = getCM(view);
        this.cm?.on("vim-mode-change", this.handleModeChange);
      }

      destroy() {
        this.cm?.off("vim-mode-change", this.handleModeChange);
        this.cm = null;
      }
    },
  );

  return [Prec.highest(vim()), modeListener];
}
