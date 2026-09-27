import { useEffectEvent, useLayoutEffect, useRef } from "react";
import {
  registerAgentDraft,
  takeAgentDraft,
  type AgentWindowDraft,
} from "../detached/agent-window-drafts";

export function useAgentDraft({
  surfaceId,
  readDraft,
  restoreDraft,
}: {
  surfaceId: string;
  readDraft: () => AgentWindowDraft;
  restoreDraft: (draft: AgentWindowDraft) => void;
}) {
  const committedReader = useRef(readDraft);
  useLayoutEffect(() => {
    committedReader.current = readDraft;
  });
  const restore = useEffectEvent(restoreDraft);
  useLayoutEffect(() => {
    const draft = takeAgentDraft(surfaceId);
    if (draft) restore(draft);
    return registerAgentDraft(surfaceId, () => committedReader.current());
  }, [surfaceId]);
}
