export type ExtensionViewTone = "default" | "muted" | "accent" | "success" | "warning" | "error";

export interface ExtensionViewAction {
  command: string;
  args?: unknown[];
}

export interface ExtensionViewBadge {
  label: string;
  tone?: ExtensionViewTone;
}

export interface ExtensionViewTreeItem {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  icon?: string;
  badges?: ExtensionViewBadge[];
  expanded?: boolean;
  onSelect?: ExtensionViewAction;
  children?: ExtensionViewTreeItem[];
}

export type ExtensionViewValue = string | number;

export type ExtensionViewFormValue = string | number | boolean | string[];
export type ExtensionViewFormValues = Record<string, ExtensionViewFormValue>;

interface ExtensionViewFormField {
  name?: string;
  required?: boolean;
}

export type ExtensionViewActivityState = "default" | "running" | "success" | "warning" | "error";
export type ExtensionViewDiffLineType = "context" | "added" | "removed" | "header";

export type ExtensionViewNode =
  | {
      type: "screen";
      title?: string;
      actions?: Array<{ label: string; action: ExtensionViewAction; icon?: string }>;
      children: ExtensionViewNode[];
    }
  | { type: "stack" | "row"; children: ExtensionViewNode[] }
  | { type: "section"; title: string; children: ExtensionViewNode[] }
  | {
      type: "card";
      title?: string;
      description?: string;
      variant?: "default" | "muted" | "outline";
      children: ExtensionViewNode[];
    }
  | {
      type: "form";
      submitLabel: string;
      pendingLabel?: string;
      onSubmit: ExtensionViewAction;
      disabled?: boolean;
      children: ExtensionViewNode[];
    }
  | { type: "text"; value: string; tone?: ExtensionViewTone }
  | { type: "badge"; label: string; tone?: ExtensionViewTone }
  | {
      type: "metric";
      label: string;
      value: ExtensionViewValue;
      detail?: string;
      tone?: ExtensionViewTone;
    }
  | { type: "progress"; value: number; label?: string; detail?: string }
  | {
      type: "sparkline";
      label: string;
      values: number[];
      detail?: string;
      tone?: ExtensionViewTone;
    }
  | {
      type: "barChart";
      label?: string;
      items: Array<{
        label: string;
        value: number;
        detail?: string;
        tone?: ExtensionViewTone;
      }>;
    }
  | {
      type: "callout";
      title: string;
      description?: string;
      tone?: "default" | "info" | "success" | "warning" | "error";
    }
  | {
      type: "table";
      columns: string[];
      rows: ExtensionViewValue[][];
      caption?: string;
    }
  | { type: "code"; value: string; language?: string; wrap?: boolean }
  | {
      type: "diff";
      filePath: string;
      oldPath?: string;
      language?: string;
      lines: Array<{
        type: ExtensionViewDiffLineType;
        content: string;
        oldLine?: number;
        newLine?: number;
      }>;
      truncated?: boolean;
    }
  | {
      type: "activity";
      items: Array<{
        title: string;
        description?: string;
        meta?: string;
        state?: ExtensionViewActivityState;
        icon?: string;
        onSelect?: ExtensionViewAction;
      }>;
    }
  | {
      type: "button";
      label: string;
      pendingLabel?: string;
      action: ExtensionViewAction;
      tone?: "default" | "accent" | "danger" | "ghost";
      disabled?: boolean;
    }
  | (ExtensionViewFormField & {
      type: "input";
      label?: string;
      value?: string;
      placeholder?: string;
      inputType?: "text" | "password" | "url";
      onChange?: ExtensionViewAction;
      onSubmit?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "textarea";
      label?: string;
      value?: string;
      placeholder?: string;
      rows?: number;
      onChange?: ExtensionViewAction;
      onSubmit?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "numberInput";
      label?: string;
      value: number;
      placeholder?: string;
      min?: number;
      max?: number;
      step?: number;
      onChange?: ExtensionViewAction;
      onSubmit?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "select";
      label?: string;
      value?: string;
      placeholder?: string;
      options: Array<{ label: string; value: string; disabled?: boolean }>;
      onChange?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "toggle";
      label: string;
      description?: string;
      checked: boolean;
      onChange?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "checkbox";
      label: string;
      description?: string;
      checked: boolean;
      onChange?: ExtensionViewAction;
      disabled?: boolean;
    })
  | (ExtensionViewFormField & {
      type: "choice";
      label?: string;
      description?: string;
      multiple?: boolean;
      value: string | string[];
      options: Array<{ label: string; value: string; disabled?: boolean }>;
      onChange?: ExtensionViewAction;
      disabled?: boolean;
    })
  | {
      type: "tabs";
      value?: string;
      tabs: Array<{
        value: string;
        label: string;
        children: ExtensionViewNode[];
        disabled?: boolean;
      }>;
      onChange?: ExtensionViewAction;
    }
  | {
      type: "disclosure";
      title: string;
      description?: string;
      open?: boolean;
      children: ExtensionViewNode[];
      onChange?: ExtensionViewAction;
    }
  | {
      type: "keyValue";
      items: Array<{
        label: string;
        value: ExtensionViewValue;
        tone?: ExtensionViewTone;
        monospace?: boolean;
      }>;
    }
  | {
      type: "list";
      children: ExtensionViewNode[];
    }
  | {
      type: "tree";
      label: string;
      items: ExtensionViewTreeItem[];
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
