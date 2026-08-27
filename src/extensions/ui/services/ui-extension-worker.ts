export interface ExtensionWorkerEvent {
  type: "event";
  event:
    | "sidebar.registerView"
    | "toolbar.registerAction"
    | "commands.register"
    | "dialogs.open"
    | "dialogs.close"
    | "views.invalidate"
    | "ready"
    | "activation.error";
  payload?: Record<string, unknown>;
}

export interface ExtensionWorkerHostCall {
  type: "host-call";
  id: number;
  method: string;
  params: unknown[];
}

export interface ExtensionWorkerCall {
  type: "worker-call";
  id: number;
  method: string;
  params: unknown[];
}

export interface ExtensionWorkerResponse {
  type: "response";
  id: number;
  result?: unknown;
  error?: string;
}

export interface ExtensionWorkerActivate {
  type: "activate";
  entryPointUrl: string;
  extensionId: string;
  compatibility?: "generated";
}

export type ExtensionWorkerMessage =
  | ExtensionWorkerEvent
  | ExtensionWorkerHostCall
  | ExtensionWorkerResponse;

export type ExtensionWorkerInboundMessage =
  | ExtensionWorkerActivate
  | ExtensionWorkerCall
  | ExtensionWorkerResponse;
