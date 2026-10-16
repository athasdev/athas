import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";
import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { resolveDockOwner } from "../services/dock-owner";
import { useDockLayoutStore } from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";

/** Whose tools the dock shows now; see `resolveDockOwner`. */
export function useDockOwner(): DockOwner | null {
  const projectPath = useProjectStore((state) => state.rootFolderPath ?? null);
  const projectKey = projectPath ? normalizeProjectTabPath(projectPath) : null;
  const activeBufferId = useActiveBufferId();
  const activeSessionId = useBufferStore((state) => {
    const buffer = activeBufferId
      ? state.buffers.find((candidate) => candidate.id === activeBufferId)
      : undefined;
    return buffer?.type === "agent" ? buffer.sessionId : null;
  });
  const openSessionKey = useBufferStore((state) =>
    state.buffers
      .flatMap((buffer) => (buffer.type === "agent" ? [buffer.sessionId] : []))
      .join("\n"),
  );
  const stickySessionId = useDockLayoutStore((state) =>
    projectKey ? state.stickySessions[projectKey] : undefined,
  );
  const { setStickySession } = useDockLayoutStore.use.actions();

  useEffect(() => {
    if (projectKey && activeSessionId) setStickySession(projectKey, activeSessionId);
  }, [activeSessionId, projectKey, setStickySession]);

  const owner = resolveDockOwner({
    activeSessionId,
    openSessionIds: openSessionKey ? openSessionKey.split("\n") : [],
    stickySessionId,
    projectPath,
  });
  const kind = owner?.kind;
  const id = owner?.id;
  return useMemo(() => (kind && id ? ({ kind, id } as DockOwner) : null), [kind, id]);
}
