export interface Disposable {
  dispose(): void;
}

export interface ViewAction {
  command: string;
  args?: unknown[];
}

export type ViewEventHandler<Value> = ViewAction | ((value: Value) => unknown | Promise<unknown>);

export type ViewNode = Record<string, unknown>;
export type ViewTone = "default" | "muted" | "accent" | "success" | "warning" | "error";
export type ViewFormValue = string | number | boolean | string[];
export type ViewFormValues = Record<string, ViewFormValue>;

export interface ViewTreeItem {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  icon?: string;
  badges?: Array<{ label: string; tone?: ViewTone }>;
  expanded?: boolean;
  onSelect?: ViewEventHandler<void>;
  children?: ViewTreeItem[];
}

export interface AthasExtensionAPI {
  sidebar: {
    registerView(config: {
      id: string;
      title: string;
      icon?: string;
      order?: number;
      render(): ViewNode | Promise<ViewNode>;
    }): Disposable;
  };
  toolbar: {
    registerAction(config: {
      id: string;
      title: string;
      icon?: string;
      position?: "left" | "right";
      onClick(): unknown | Promise<unknown>;
    }): Disposable;
  };
  dialog: {
    open(config: {
      id: string;
      title: string;
      render(): ViewNode | Promise<ViewNode>;
      width?: number;
      height?: number;
    }): void;
    close(dialogId: string): void;
  };
  views: { invalidate(viewId: string): void };
  commands: {
    register(config: {
      id: string;
      title: string;
      category?: string;
      run(...args: unknown[]): unknown | Promise<unknown>;
    }): Disposable;
    execute(command: string, ...args: unknown[]): Promise<unknown>;
  };
  http: {
    request(request: {
      url: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  workspace: {
    getCurrent(): Promise<{
      rootPath: string | null;
      repoPath: string | null;
      activeFilePath: string | null;
      remotes: Array<{ name: string; url: string }>;
    }>;
  };
  notifications: {
    show(options: {
      title: string;
      description?: string;
      tone?: "default" | "info" | "success" | "warning" | "error";
      duration?: number;
    }): Promise<void>;
  };
  clipboard: { writeText(text: string): Promise<void> };
  opener: { openExternal(url: string): Promise<void> };
  ui: {
    action(command: string, ...args: unknown[]): ViewAction;
    screen(config?: Record<string, unknown>, ...children: ViewNode[]): ViewNode;
    stack(...children: ViewNode[]): ViewNode;
    row(...children: ViewNode[]): ViewNode;
    section(title: string, ...children: ViewNode[]): ViewNode;
    card(
      config: {
        title?: string;
        description?: string;
        variant?: "default" | "muted" | "outline";
      },
      ...children: ViewNode[]
    ): ViewNode;
    form(
      config: {
        submitLabel: string;
        pendingLabel?: string;
        onSubmit: ViewEventHandler<ViewFormValues>;
        disabled?: boolean;
      },
      ...children: ViewNode[]
    ): ViewNode;
    text(value: unknown, tone?: ViewTone): ViewNode;
    badge(label: unknown, tone?: ViewTone): ViewNode;
    metric(options: {
      label: string;
      value: string | number;
      detail?: string;
      tone?: ViewTone;
    }): ViewNode;
    progress(options: { value: number; label?: string; detail?: string }): ViewNode;
    sparkline(options: {
      label: string;
      values: number[];
      detail?: string;
      tone?: ViewTone;
    }): ViewNode;
    barChart(options: {
      label?: string;
      items: Array<{
        label: string;
        value: number;
        detail?: string;
        tone?: ViewTone;
      }>;
    }): ViewNode;
    callout(options: {
      title: string;
      description?: string;
      tone?: "default" | "info" | "success" | "warning" | "error";
    }): ViewNode;
    table(options: {
      columns: string[];
      rows: Array<Array<string | number>>;
      caption?: string;
    }): ViewNode;
    code(options: { value: string; language?: string; wrap?: boolean }): ViewNode;
    diff(options: {
      filePath: string;
      oldPath?: string;
      language?: string;
      lines: Array<{
        type: "context" | "added" | "removed" | "header";
        content: string;
        oldLine?: number;
        newLine?: number;
      }>;
      truncated?: boolean;
    }): ViewNode;
    activity(options: {
      items: Array<{
        title: string;
        description?: string;
        meta?: string;
        state?: "default" | "running" | "success" | "warning" | "error";
        icon?: string;
        onSelect?: ViewEventHandler<void>;
      }>;
    }): ViewNode;
    button(
      label: string,
      action: ViewAction,
      options?: {
        tone?: "default" | "accent" | "danger" | "ghost";
        disabled?: boolean;
        pendingLabel?: string;
      },
    ): ViewNode;
    input(options: {
      name?: string;
      required?: boolean;
      label?: string;
      value?: string;
      placeholder?: string;
      inputType?: "text" | "password" | "url";
      onChange?: ViewEventHandler<string>;
      onSubmit?: ViewEventHandler<string>;
      disabled?: boolean;
    }): ViewNode;
    textarea(options: {
      name?: string;
      required?: boolean;
      label?: string;
      value?: string;
      placeholder?: string;
      rows?: number;
      onChange?: ViewEventHandler<string>;
      onSubmit?: ViewEventHandler<string>;
      disabled?: boolean;
    }): ViewNode;
    numberInput(options: {
      name?: string;
      required?: boolean;
      label?: string;
      value: number;
      placeholder?: string;
      min?: number;
      max?: number;
      step?: number;
      onChange?: ViewEventHandler<number>;
      onSubmit?: ViewEventHandler<number>;
      disabled?: boolean;
    }): ViewNode;
    select(options: {
      name?: string;
      required?: boolean;
      label?: string;
      value?: string;
      placeholder?: string;
      options: Array<{ label: string; value: string; disabled?: boolean }>;
      onChange?: ViewEventHandler<string>;
      disabled?: boolean;
    }): ViewNode;
    toggle(options: {
      name?: string;
      required?: boolean;
      label: string;
      description?: string;
      checked: boolean;
      onChange?: ViewEventHandler<boolean>;
      disabled?: boolean;
    }): ViewNode;
    checkbox(options: {
      name?: string;
      required?: boolean;
      label: string;
      description?: string;
      checked: boolean;
      onChange?: ViewEventHandler<boolean>;
      disabled?: boolean;
    }): ViewNode;
    choice(options: {
      name?: string;
      required?: boolean;
      label?: string;
      description?: string;
      multiple?: boolean;
      value: string | string[];
      options: Array<{ label: string; value: string; disabled?: boolean }>;
      onChange?: ViewEventHandler<string | string[]>;
      disabled?: boolean;
    }): ViewNode;
    tabs(options: {
      value?: string;
      tabs: Array<{
        value: string;
        label: string;
        children: ViewNode[];
        disabled?: boolean;
      }>;
      onChange?: ViewEventHandler<string>;
    }): ViewNode;
    disclosure(
      config: {
        title: string;
        description?: string;
        open?: boolean;
        onChange?: ViewEventHandler<boolean>;
      },
      ...children: ViewNode[]
    ): ViewNode;
    keyValue(options: {
      items: Array<{
        label: string;
        value: string | number;
        tone?: ViewTone;
        monospace?: boolean;
      }>;
    }): ViewNode;
    list(...children: ViewNode[]): ViewNode;
    tree(options: { label: string; items: ViewTreeItem[] }): ViewNode;
    listItem(options: Record<string, unknown>): ViewNode;
    empty(message: string, description?: string): ViewNode;
    loading(message?: string): ViewNode;
    error(message: string, description?: string): ViewNode;
    divider(): ViewNode;
  };
}

export function activate(api: AthasExtensionAPI): void | Promise<void>;
export function deactivate(): void | Promise<void>;
