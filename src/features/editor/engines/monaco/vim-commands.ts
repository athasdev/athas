import { VimMode } from "monaco-vim";
import { parseAndExecuteVimCommand, vimCommands } from "@/features/vim/stores/vim-commands";
import type { VimMode as EditorVimMode } from "@/features/vim/stores/vim.store";

let monacoVimCommandsRegistered = false;

export function registerMonacoVimCommands(): void {
  if (monacoVimCommandsRegistered) return;
  monacoVimCommandsRegistered = true;

  const vimApi = (
    VimMode as unknown as {
      Vim?: {
        defineEx: (
          name: string,
          prefix: string,
          callback: (_cm: unknown, params: unknown) => void,
        ) => void;
      };
    }
  ).Vim;
  if (!vimApi) return;

  const register = (name: string, prefix: string) => {
    vimApi.defineEx(name, prefix, (_cm, params) => {
      const argString =
        typeof params === "object" && params && "argString" in params
          ? String((params as { argString?: string }).argString ?? "")
          : "";
      const input = `${prefix}${argString ? ` ${argString.trim()}` : ""}`;
      void parseAndExecuteVimCommand(input);
    });
  };

  for (const command of vimCommands) {
    register(command.name, command.name);
    for (const alias of command.aliases ?? []) {
      register(alias, alias);
    }
  }
}

export function toEditorVimMode(mode: string): EditorVimMode {
  if (mode === "insert") return "insert";
  if (mode === "visual") return "visual";
  return "normal";
}
