export interface AgentSuggestion {
  id: string;
  kind: "review" | "problems" | "file" | "skill" | "prompt";
  title: string;
  /** The prompt inserted into the composer. */
  content: string;
}
