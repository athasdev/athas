import { useEffect, useRef } from "react";
import type { ExtensionInstallRequest } from "@/extensions/hooks/use-extension-install-prompt";
import type { AcpTerminalAuthExit } from "@/features/ai/services/acp-terminal-auth";
import type { AIChatSkillInsertDetail } from "@/features/ai/services/skill-events";
import type { GitChange } from "@/features/git/events/git-events";
import type { GitSidebarAction } from "@/features/git/types/git.types";
import type { GitHubSidebarAction } from "@/features/github/types/github.types";
import type { OpenNotificationsCommandDetail } from "@/features/notifications/constants/notifications-events";
import type { ShareDraft } from "@/features/sharing/types/share.types";
import type { SidebarDragResource } from "@/features/sidebar/services/sidebar-resource-drag";
import type {
  TerminalCommandNavigationDirection,
  TerminalCommandSummary,
  TerminalSplitDirection,
} from "@/features/terminal/types/terminal.types";

/**
 * In-process events between features of one window, with typed payloads.
 *
 * Each key is an event name and its value the payload type; `undefined` means the event carries
 * no payload. Names are `domain:action` in kebab case, where the domain is the feature the event
 * is about (`terminal:split`, `git:changed`). Every key must have at least one emitter and one listener in `src`
 * (`src/utils/tests/app-events-contract.test.ts` checks this).
 *
 * The bus is per JavaScript realm, exactly like the `window` CustomEvents it replaced: the main
 * window and each detached window have their own. Events that cross windows or come from Rust
 * stay on Tauri events and are not listed here: the native menu (`menu://action`,
 * `features/window/services/menu-actions.ts`), ACP buffer reads (`acp-buffer-read`), workspace file
 * changes and the other `listen(...)` channels. Dropped files for a terminal stay a DOM event
 * (`athas-terminal-file-drop`) because they are dispatched on the terminal element under the
 * pointer, not broadcast.
 */
export interface AppEventMap {
  // Editor
  "editor:go-to-line": { line: number; column?: number; path?: string; focus?: boolean };
  "editor:trigger-suggest": undefined;
  "editor:trigger-signature-help": undefined;
  "editor:show-hover": undefined;
  "editor:rename-symbol": undefined;
  "extensions:install-needed": ExtensionInstallRequest;
  "file:external-change": { path: string; agentWriteId?: number };

  // Terminal
  "terminal:new": undefined;
  "terminal:close-active": undefined;
  "terminal:ensure-session": undefined;
  "terminal:open-search": undefined;
  "terminal:clear": undefined;
  "terminal:select-all": undefined;
  "terminal:copy-last-command-output": undefined;
  "terminal:unsplit": undefined;
  "terminal:split": TerminalSplitDirection;
  "terminal:focus-pane": "next" | "previous";
  "terminal:navigate-command": TerminalCommandNavigationDirection;
  "terminal:switch-tab": "next" | "prev";
  "terminal:activate-tab": number;
  "terminal:detach-to-buffer": { terminalId: string };
  "terminal:create-with-command": {
    command: string;
    name?: string;
    workingDirectory?: string;
    environment?: Record<string, string>;
  };
  "terminal:ready": { terminalId: string; connectionId: string; remoteConnectionId?: string };
  "terminal:command-finished": { terminalId: string; command: TerminalCommandSummary };
  "terminal:process-exit": { sessionId: string } & AcpTerminalAuthExit;
  "terminal:refit": { sessionId: string };
  "terminal:pane-drop-hover": undefined;

  // Workbench, panes and drag and drop
  "tabs:internal-drag-hover": undefined;
  "file-tree:drop-on-pane": { path: string; name: string; isDir: boolean; x: number; y: number };
  "file-tree:open-search": undefined;
  "sidebar:resource-drop-on-ai": { resource: SidebarDragResource };
  "browser:focus-address-bar": string;
  "toast:dismissed": { toastId: string };
  "window:request-close": undefined;
  "notifications:show": OpenNotificationsCommandDetail | undefined;
  "feedback:open": undefined;
  "updater:dismissed": undefined;
  "updater:preferences-changed": undefined;
  "team:workspace-changed": string;

  // Debugger
  "debugger:start": undefined;
  "debugger:stop": undefined;
  "debugger:restart": undefined;

  // Git and GitHub
  "git:changed": GitChange;
  "git:palette-action": GitSidebarAction;
  "git:open-branch-manager": { tab: "branches" | "worktrees" | "repositories" };
  "github:palette-action": GitHubSidebarAction;

  // AI and sharing
  "ai:insert-skill": AIChatSkillInsertDetail;
  "ai:open-agent-sessions": string;
  "ai:codex-settings-changed": undefined;
  "sharing:open": ShareDraft;
  "sharing:status": { error: string | null; syncedAt?: number };
}

export type AppEventName = keyof AppEventMap;

type AppEventHandler<K extends AppEventName> = (payload: AppEventMap[K]) => void;

type AppEventArgs<K extends AppEventName> = undefined extends AppEventMap[K]
  ? [payload?: AppEventMap[K]]
  : [payload: AppEventMap[K]];

const handlersByName = new Map<AppEventName, Set<AppEventHandler<never>>>();

function reportHandlerError(error: unknown) {
  if (typeof globalThis.reportError === "function") {
    globalThis.reportError(error);
  } else {
    console.error(error);
  }
}

/**
 * Delivers `payload` synchronously to the handlers of `name`, in subscription order, like
 * `window.dispatchEvent`: a handler added during delivery waits for the next emit, a handler
 * removed during delivery is skipped, and a throwing handler is reported without stopping the rest.
 */
export function emitAppEvent<K extends AppEventName>(name: K, ...[payload]: AppEventArgs<K>): void {
  const handlers = handlersByName.get(name) as Set<AppEventHandler<K>> | undefined;
  if (!handlers || handlers.size === 0) return;

  for (const handler of Array.from(handlers)) {
    if (!handlers.has(handler)) continue;
    try {
      handler(payload as AppEventMap[K]);
    } catch (error) {
      reportHandlerError(error);
    }
  }
}

/** Subscribes `handler` to `name`; the returned function unsubscribes it. */
export function onAppEvent<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): () => void {
  let handlers = handlersByName.get(name) as Set<AppEventHandler<K>> | undefined;
  if (!handlers) {
    handlers = new Set();
    handlersByName.set(name, handlers as Set<AppEventHandler<never>>);
  }
  handlers.add(handler);

  return () => {
    handlers.delete(handler);
  };
}

/**
 * Subscribes a component to `name` for as long as it is mounted. The subscription stays the same
 * across renders and always calls the latest `handler`.
 */
export function useAppEvent<K extends AppEventName>(name: K, handler: AppEventHandler<K>): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => onAppEvent(name, (payload) => handlerRef.current(payload)), [name]);
}
