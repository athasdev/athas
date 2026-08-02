export interface Disposable {
  dispose(): void;
}

export interface ViewAction {
  command: string;
  args?: unknown[];
}

export type ViewNode = Record<string, unknown>;

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
  opener: { openExternal(url: string): Promise<void> };
  ui: {
    action(command: string, ...args: unknown[]): ViewAction;
    screen(config?: Record<string, unknown>, ...children: ViewNode[]): ViewNode;
    stack(...children: ViewNode[]): ViewNode;
    row(...children: ViewNode[]): ViewNode;
    section(title: string, ...children: ViewNode[]): ViewNode;
    text(value: unknown, tone?: string): ViewNode;
    badge(label: unknown, tone?: string): ViewNode;
    button(label: string, action: ViewAction, options?: Record<string, unknown>): ViewNode;
    input(options: Record<string, unknown>): ViewNode;
    list(...children: ViewNode[]): ViewNode;
    listItem(options: Record<string, unknown>): ViewNode;
    empty(message: string, description?: string): ViewNode;
    loading(message?: string): ViewNode;
    error(message: string, description?: string): ViewNode;
    divider(): ViewNode;
  };
}

export function activate(api: AthasExtensionAPI): void | Promise<void>;
export function deactivate(): void | Promise<void>;
