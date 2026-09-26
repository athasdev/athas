export interface ChatAcpEvent {
  id: string;
  category: "plan" | "error" | "permission" | "status" | "notice";
  label: string;
  detail?: string;
  state?: "running" | "success" | "error" | "warning" | "info";
  timestamp: Date;
}
