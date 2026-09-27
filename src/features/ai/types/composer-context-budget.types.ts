export type ComposerBudgetTone = "accent" | "warning" | "error";

export interface ComposerBudgetGroup {
  id: "files" | "rules" | "history" | "references" | "system";
  label: string;
  tokens: number;
  count: number;
  truncated: boolean;
}
