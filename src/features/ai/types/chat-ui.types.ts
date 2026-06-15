export interface ChatAcpEvent {
  id: string;
  kind: "thinking" | "tool" | "plan" | "mode" | "error" | "permission" | "status";
  label: string;
  detail?: string;
  state?: "running" | "success" | "error" | "info";
  timestamp: Date;
}
