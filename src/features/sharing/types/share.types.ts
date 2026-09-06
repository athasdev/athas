export interface ShareDraft {
  kind: "snippet" | "buffer" | "agent";
  title: string;
  content: string;
  language: string;
  startLine?: number;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ShareOptions {
  pro: boolean;
  organizations: Array<{ id: number; name: string }>;
}

export interface ShareInput extends ShareDraft {
  requestId: string;
  visibility: "public" | "email" | "organization";
  emails: string[];
  workspaceId: number | null;
}
