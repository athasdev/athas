export interface ChatAcpEvent {
  id: string;
  category: "plan" | "error" | "permission" | "status";
  label: string;
  detail?: string;
  state?: "running" | "success" | "error" | "info";
  timestamp: Date;
}
