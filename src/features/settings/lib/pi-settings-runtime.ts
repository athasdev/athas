import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatScopeId } from "@/features/ai/types/ai-chat";
import { PiNativeStreamHandler } from "@/utils/pi-native-handler";

interface WindowEventTargetLike {
  addEventListener: (type: "focus", listener: () => void) => void;
  removeEventListener: (type: "focus", listener: () => void) => void;
}

interface DocumentEventTargetLike {
  visibilityState: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

interface PiSettingsAutoRefreshOptions {
  windowTarget?: WindowEventTargetLike | null;
  documentTarget?: DocumentEventTargetLike | null;
}

export function getActivePiNativeScopeIdsForWorkspace(workspacePath: string | null): ChatScopeId[] {
  if (!workspacePath) {
    return [];
  }

  const state = useAIChatStore.getState();
  const scopeIds = Object.keys(state.chatScopes) as ChatScopeId[];

  return scopeIds.filter((scopeId) => {
    const runtimeState = state.getCurrentChat(scopeId)?.acpState?.runtimeState;
    return runtimeState?.source === "pi-native" && runtimeState.workspacePath === workspacePath;
  });
}

export async function reloadActivePiNativeSessionsForWorkspace(
  workspacePath: string | null,
): Promise<ChatScopeId[]> {
  const scopeIds = getActivePiNativeScopeIdsForWorkspace(workspacePath);
  await Promise.all(
    scopeIds.map((scopeId) => {
      return PiNativeStreamHandler.reloadSessionResources(scopeId);
    }),
  );
  return scopeIds;
}

export function subscribePiSettingsAutoRefresh(
  refresh: () => void | Promise<void>,
  options: PiSettingsAutoRefreshOptions = {},
): () => void {
  const windowTarget =
    options.windowTarget ??
    ((typeof window !== "undefined" ? window : null) as WindowEventTargetLike | null);
  const documentTarget =
    options.documentTarget ??
    ((typeof document !== "undefined" ? document : null) as DocumentEventTargetLike | null);

  if (!windowTarget || !documentTarget) {
    return () => {};
  }

  const runRefresh = () => {
    void refresh();
  };

  const handleFocus = () => {
    runRefresh();
  };

  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") {
      runRefresh();
    }
  };

  windowTarget.addEventListener("focus", handleFocus);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    windowTarget.removeEventListener("focus", handleFocus);
    documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
