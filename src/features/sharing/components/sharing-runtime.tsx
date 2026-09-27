import { getAuthToken } from "@/features/window/services/auth-api";
import { useEffect } from "react";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import {
  initChatDatabase,
  loadAllChatsFromDb,
  loadChatFromDb,
} from "@/features/ai/services/ai-chat-history-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { conversationContent, conversationMessages } from "../lib/snapshot-content";
import {
  fetchShareOptions,
  isRejectedShareRequest,
  shareRequest,
  updateShare,
} from "../services/share-api";
import { getShareDeviceId } from "../services/share-device";
import type { ShareDraft } from "../types/share.types";

const maxTitleLength = 200;

function sessionTitle(title: string | null | undefined) {
  return (title ?? "").trim().slice(0, maxTitleLength) || "Untitled session";
}

export function SharingRuntime() {
  const userId = useAuthStore((state) => state.user?.id);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deviceId = getShareDeviceId();
    const sent = new Map<string, string>();
    const requests = new Map<string, string>();
    const rejected = new Map<string, string>();
    const current = () => !cancelled && useAuthStore.getState().user?.id === userId;
    // Chats loaded from the database, reused until their last message changes.
    const loadedChats = new Map<
      string,
      { lastMessageAt: number; chat: Awaited<ReturnType<typeof loadChatFromDb>> }
    >();
    let isChatDatabaseReady = false;
    let isSyncing = false;
    const loadChat = async (id: string, lastMessageAt: number) => {
      const cached = loadedChats.get(id);
      if (cached && cached.lastMessageAt === lastMessageAt) return cached.chat;
      const chat = await loadChatFromDb(id);
      loadedChats.set(id, { lastMessageAt, chat });
      return chat;
    };
    const sync = async () => {
      // Nothing to publish while the window is hidden; visibility brings it back straight away.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (current()) timer = setTimeout(() => void sync(), 3000);
        return;
      }
      isSyncing = true;
      try {
        const token = await getAuthToken();
        if (!token || !current()) return;
        const options = await fetchShareOptions(token);
        if (!current()) return;
        const drafts = new Map<string, ShareDraft>();
        const summaries = new Map(useAIChatStore.getState().chats.map((chat) => [chat.id, chat]));
        if (options.sessionsEnabled) {
          if (!isChatDatabaseReady) {
            await initChatDatabase();
            isChatDatabaseReady = true;
          }
          for (const chat of await loadAllChatsFromDb()) {
            if (!summaries.has(chat.id)) summaries.set(chat.id, { ...chat, messages: [] });
          }
        }
        let syncError: unknown;
        for (const summary of [...summaries.values()].sort(
          (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
        )) {
          try {
            if (
              !options.sessionsEnabled &&
              !options.items.some(
                (item) => item.live && item.sourceId === summary.id && item.deviceId === deviceId,
              )
            )
              continue;
            const chat = summary.messages.length
              ? summary
              : await loadChat(summary.id, summary.lastMessageAt.getTime());
            if (!current()) return;
            const latest = useAIChatStore.getState().chats.find((entry) => entry.id === summary.id);
            const messages = latest?.messages.length ? latest.messages : chat.messages;
            const content = conversationContent(messages);
            if (!content || content.length > 500_000) continue;
            drafts.set(summary.id, {
              sourceUpdatedAt: (latest?.messages.length
                ? latest.lastMessageAt
                : chat.lastMessageAt
              ).getTime(),
              kind: "agent",
              title: sessionTitle(summary.title),
              content,
              messages: conversationMessages(messages),
              language: "markdown",
              sourceId: summary.id,
              deviceId,
            });
          } catch (error) {
            syncError = error;
          }
        }
        for (const buffer of useBufferStore.getState().buffers) {
          if (buffer.type === "editor" && buffer.content.length <= 500_000)
            drafts.set(buffer.id, {
              kind: "buffer",
              title: buffer.name,
              content: buffer.content,
              language: buffer.languageOverride || buffer.language || "text",
              sourceId: buffer.id,
              deviceId,
            });
        }
        for (const [sourceId, draft] of drafts) {
          try {
            if (!current()) return;
            if (
              options.sessionsEnabled &&
              !options.excludedSources.some(
                (item) => item.deviceId === deviceId && item.sourceId === sourceId,
              ) &&
              draft.kind === "agent" &&
              !options.items.some(
                (item) =>
                  item.visibility === "private" &&
                  item.sourceId === sourceId &&
                  item.deviceId === deviceId,
              )
            ) {
              const requestId = requests.get(sourceId) || crypto.randomUUID();
              requests.set(sourceId, requestId);
              const payload = JSON.stringify({
                ...draft,
                requestId,
                visibility: "private",
                live: true,
              });
              if (rejected.get(sourceId) !== payload) {
                try {
                  await shareRequest(
                    "/api/cloud-sessions",
                    { method: "POST", body: payload },
                    token,
                  );
                  rejected.delete(sourceId);
                } catch (error) {
                  // A rejected payload is only retried once its content changes.
                  if (isRejectedShareRequest(error)) rejected.set(sourceId, payload);
                  throw error;
                }
              }
            }
            for (const item of options.items) {
              if (!current()) return;
              if (
                !item.live ||
                item.deviceId !== deviceId ||
                item.sourceId !== sourceId ||
                (item.visibility === "private" && !options.sessionsEnabled)
              )
                continue;
              const changes = {
                sourceUpdatedAt: draft.sourceUpdatedAt,
                title: draft.title,
                content: draft.content,
                messages: draft.messages,
                language: draft.language,
              };
              const signature = JSON.stringify(changes);
              if (sent.get(item.id) === `${item.revision}:${signature}`) continue;
              const result = await updateShare(item.id, item.revision, changes, token);
              sent.set(item.id, `${result.revision}:${signature}`);
            }
          } catch (error) {
            syncError = error;
          }
        }
        if (syncError) throw syncError;
        if (!current()) return;
        window.dispatchEvent(
          new CustomEvent("athas:sharing-status", {
            detail: { error: null, syncedAt: Date.now() },
          }),
        );
      } catch (error) {
        if (current())
          window.dispatchEvent(
            new CustomEvent("athas:sharing-status", {
              detail: { error: error instanceof Error ? error.message : "Could not sync sessions" },
            }),
          );
      } finally {
        isSyncing = false;
        if (current()) timer = setTimeout(() => void sync(), 3000);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !current() || isSyncing) return;
      clearTimeout(timer);
      void sync();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    void sync();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [userId]);
  return null;
}
