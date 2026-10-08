import type { McpTransport } from "@/features/settings/types/ai-settings.types";

export type { McpServerSetting, McpTransport } from "@/features/settings/types/ai-settings.types";

export interface McpNameValue {
  name: string;
  value: string;
}

/** The part of a server kept in secure storage. */
export interface McpServerSecrets {
  env: McpNameValue[];
  headers: McpNameValue[];
}

/** A server being added or edited: settings fields plus secrets, args as one per line. */
export interface McpServerDraft {
  id: string | null;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  env: McpNameValue[];
  headers: McpNameValue[];
}

export type McpServerDraftField = "name" | "command" | "url" | "env" | "headers";

export type McpServerDraftErrors = Partial<Record<McpServerDraftField, string>>;

/** A configured server an agent did not take because it does not support the transport. */
export interface AcpSkippedMcpServer {
  name: string;
  transport: McpTransport;
}
