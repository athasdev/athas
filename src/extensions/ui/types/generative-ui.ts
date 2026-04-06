export interface GenerativeUIComponent {
  type: "card" | "form" | "list" | "table" | "custom";
  props: Record<string, unknown>;
  children?: GenerativeUIComponent[];
  actions?: GenerativeUIAction[];
}

export interface GenerativeUIAction {
  id: string;
  label: string;
  command?: string;
  url?: string;
  style?: "primary" | "secondary" | "danger";
}
