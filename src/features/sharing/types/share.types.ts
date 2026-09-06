export interface ShareDraft {
  sourceUpdatedAt?: number;
  sourceId?: string;
  deviceId?: string;
  live?: boolean;
  kind: "snippet" | "buffer" | "agent";
  title: string;
  content: string;
  language: string;
  startLine?: number;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ShareOptions {
  pro: boolean;
  sessionsEnabled: boolean;
  excludedSources: Array<{ deviceId: string; sourceId: string }>;
  items: SharedItem[];
  organizations: Array<{ id: number; name: string }>;
}

export interface ShareInput extends ShareDraft {
  requestId: string;
  visibility: "public" | "email" | "organization";
  emails: string[];
  workspaceId: number | null;
}

export interface SharedItem {
  id: string;
  title: string;
  kind: ShareDraft["kind"];
  visibility: ShareInput["visibility"] | "private";
  live: boolean;
  sourceId?: string;
  deviceId?: string;
  revision: number;
  updatedAt: number;
  emails: string[];
  workspaceId: number | null;
}
