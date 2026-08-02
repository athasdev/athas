export type ExtensionViewTone = "default" | "muted" | "accent" | "success" | "warning" | "error";

export interface ExtensionViewAction {
  command: string;
  args?: unknown[];
}

export interface ExtensionViewBadge {
  label: string;
  tone?: ExtensionViewTone;
}

export type ExtensionViewNode =
  | {
      type: "screen";
      title?: string;
      actions?: Array<{ label: string; action: ExtensionViewAction; icon?: string }>;
      children: ExtensionViewNode[];
    }
  | { type: "stack" | "row"; children: ExtensionViewNode[] }
  | { type: "section"; title: string; children: ExtensionViewNode[] }
  | { type: "text"; value: string; tone?: ExtensionViewTone }
  | { type: "badge"; label: string; tone?: ExtensionViewTone }
  | {
      type: "button";
      label: string;
      action: ExtensionViewAction;
      tone?: "default" | "accent" | "danger" | "ghost";
      disabled?: boolean;
    }
  | {
      type: "input";
      label?: string;
      value?: string;
      placeholder?: string;
      inputType?: "text" | "password" | "url";
      onChange: ExtensionViewAction;
    }
  | {
      type: "list";
      children: ExtensionViewNode[];
    }
  | {
      type: "listItem";
      title: string;
      description?: string;
      meta?: string;
      badges?: ExtensionViewBadge[];
      onSelect?: ExtensionViewAction;
    }
  | { type: "empty"; message: string; description?: string }
  | { type: "loading"; message?: string }
  | { type: "error"; message: string; description?: string }
  | { type: "divider" };

export interface ExtensionWorkspaceContext {
  rootPath: string | null;
  repoPath: string | null;
  activeFilePath: string | null;
  remotes: Array<{ name: string; url: string }>;
}

export interface ExtensionHttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface ExtensionHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
