import { commands } from "@/bindings/commands";

export const startCodexIntegration = (cwd: string) => commands.startCodexIntegration({ cwd });

export const listCodexSkills = (cwd: string) => commands.listCodexSkills(cwd);

export const listCodexMcpServers = () =>
  commands.listCodexMcpServers() as Promise<{ data?: unknown[]; servers?: unknown[] }>;

export const listCodexThreads = (cwd: string) => commands.listCodexThreads(cwd, null, null);

export const signInToCodex = () => commands.startCodexLogin("chatgpt");

export const signOutOfCodex = () => commands.logoutCodexAccount();
