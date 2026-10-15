import { useCallback, useMemo } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { EMPTY_CLOUD_DRAFT, useCloudEnvironmentStore } from "../stores/cloud-environment.store";
import type { AgentEnvironmentKind } from "../services/cloud-environment";
import { setChatCloudTarget, setChatEnvironmentKind } from "../services/cloud-session";

export interface AgentEnvironment {
  kind: AgentEnvironmentKind;
  repo: string | null;
  branch: string | null;
  /** The session already has a conversation, so where it runs is settled. */
  locked: boolean;
  setKind: (kind: AgentEnvironmentKind) => void;
  setRepo: (repo: string) => void;
  setBranch: (branch: string) => void;
}

/**
 * Where a composer's agent runs: on this machine or in the cloud, with the repository and branch
 * a cloud run starts from. A session keeps it in its settings; a composer without a session yet
 * keeps a draft under `draftKey` until it starts one.
 */
export function useAgentEnvironment({
  chatId,
  draftKey,
}: {
  chatId: string | null | undefined;
  draftKey: string;
}): AgentEnvironment {
  const hasChat = useAIChatStore((state) =>
    chatId ? state.chats.some((chat) => chat.id === chatId) : false,
  );
  const cloud = useAIChatStore((state) =>
    chatId ? state.chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud : undefined,
  );
  const hasMessages = useAIChatStore((state) =>
    chatId ? (state.messagesByChat[chatId]?.length ?? 0) > 0 : false,
  );
  const draft = useCloudEnvironmentStore((state) => state.drafts[draftKey] ?? EMPTY_CLOUD_DRAFT);
  const { updateDraft } = useCloudEnvironmentStore.use.actions();

  const setKind = useCallback(
    (kind: AgentEnvironmentKind) => {
      if (chatId && hasChat) setChatEnvironmentKind(chatId, kind);
      else updateDraft(draftKey, { kind });
    },
    [chatId, draftKey, hasChat, updateDraft],
  );
  const setRepo = useCallback(
    (repo: string) => {
      if (chatId && hasChat) setChatCloudTarget(chatId, { repo });
      else updateDraft(draftKey, { repo, branch: draft.repo === repo ? draft.branch : null });
    },
    [chatId, draft.branch, draft.repo, draftKey, hasChat, updateDraft],
  );
  const setBranch = useCallback(
    (branch: string) => {
      if (chatId && hasChat) setChatCloudTarget(chatId, { branch });
      else updateDraft(draftKey, { branch });
    },
    [chatId, draftKey, hasChat, updateDraft],
  );

  return useMemo<AgentEnvironment>(() => {
    if (chatId && hasChat) {
      return {
        kind: cloud ? "cloud" : "local",
        repo: cloud?.repo ?? null,
        branch: cloud?.branch ?? null,
        locked: hasMessages,
        setKind,
        setRepo,
        setBranch,
      };
    }
    return { ...draft, locked: false, setKind, setRepo, setBranch };
  }, [chatId, cloud, draft, hasChat, hasMessages, setBranch, setKind, setRepo]);
}
