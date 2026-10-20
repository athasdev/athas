import { useMemo } from "react";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { resolveDockOwner } from "../services/dock-owner";
import { useActiveSessionId } from "./use-active-session-id";
import type { DockOwner } from "../types/dock.types";

/** Whose tools the dock shows now; see `resolveDockOwner`. */
export function useDockOwner(): DockOwner | null {
  const projectPath = useProjectStore((state) => state.rootFolderPath ?? null);
  const activeSessionId = useActiveSessionId();
  const owner = resolveDockOwner({ activeSessionId, projectPath });
  const kind = owner?.kind;
  const id = owner?.id;
  return useMemo(() => (kind && id ? ({ kind, id } as DockOwner) : null), [kind, id]);
}
