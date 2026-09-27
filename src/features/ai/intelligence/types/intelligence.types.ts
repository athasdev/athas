export const intelligenceTasks = [
  "agent",
  "autocomplete",
  "inline-edit",
  "commit-message",
  "chat-title",
  "terminal-title",
  "github-draft",
  "review-summary",
  "review-insight",
] as const;

export type IntelligenceTask = (typeof intelligenceTasks)[number];
export interface IntelligenceConnection {
  providerId: string;
  modelId: string;
}
export interface IntelligencePreferences {
  defaultConnection: IntelligenceConnection;
  tasks: Partial<Record<IntelligenceTask, IntelligenceConnection>>;
  autoRouting: boolean;
}
export interface IntelligenceScope {
  id: string;
  name: string;
  canEdit: boolean;
}
export interface IntelligenceSnapshot {
  scope: string;
  scopes: IntelligenceScope[];
  preferences: IntelligencePreferences;
  revision: number;
  updatedAt: string | null;
}
