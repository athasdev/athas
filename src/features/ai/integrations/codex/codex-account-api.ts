import { commands } from "@/bindings/commands";
import { clearCodexCatalog } from "./codex-composer-catalog";

export const startCodexIntegration = (cwd: string) => commands.startCodexIntegration({ cwd });

export const listCodexSkills = (cwd: string) => commands.listCodexSkills(cwd);

export const listCodexMcpServers = () =>
  commands.listCodexMcpServers() as Promise<{ data?: unknown[]; servers?: unknown[] }>;

export const listCodexThreads = (cwd: string) => commands.listCodexThreads(cwd, null, null);

export const signInToCodex = () => commands.startCodexLogin("chatgpt");

export async function signOutOfCodex() {
  try {
    return await commands.logoutCodexAccount();
  } finally {
    clearCodexCatalog();
  }
}
