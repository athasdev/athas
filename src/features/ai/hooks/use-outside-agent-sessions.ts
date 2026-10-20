import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  listOutsideAgentSessions,
  type OutsideAgentSession,
  withoutHeldSessions,
} from "@/features/ai/services/outside-agent-sessions";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { queryClient } from "@/utils/query-client";

const NO_SESSIONS: OutsideAgentSession[] = [];
const OUTSIDE_SESSIONS_STALE_MS = 5 * 60_000;

/**
 * The Claude and Codex conversations kept for a project that no Athas chat holds yet, listed
 * only while `enabled` (the project is expanded) and cached for a few minutes.
 */
export function useOutsideAgentSessions(projectPath: string, enabled: boolean) {
  const chats = useAIChatStore((state) => state.chats);
  const { data } = useQuery(
    {
      queryKey: ["outside-agent-sessions", projectPath],
      queryFn: () => listOutsideAgentSessions(projectPath),
      enabled,
      staleTime: OUTSIDE_SESSIONS_STALE_MS,
      refetchOnWindowFocus: false,
    },
    queryClient,
  );
  return useMemo(() => (data ? withoutHeldSessions(data, chats) : NO_SESSIONS), [chats, data]);
}
