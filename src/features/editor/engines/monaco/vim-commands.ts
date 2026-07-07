import { VimMode } from "monaco-vim";
import { parseAndExecuteVimCommand, vimCommands } from "@/features/vim/stores/vim-commands";
import type { VimMode as AthasVimMode } from "@/features/vim/stores/vim.store";

let athasVimCommandsRegistered = false;

export function registerAthasVimCommands(): void {
  if (athasVimCommandsRegistered) return;
  athasVimCommandsRegistered = true;

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

export function toAthasVimMode(mode: string): AthasVimMode {
  if (mode === "insert") return "insert";
  if (mode === "visual") return "visual";
  return "normal";
}
