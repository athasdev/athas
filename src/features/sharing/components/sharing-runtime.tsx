import { getAuthToken } from "@/features/window/services/auth-api";
import { useEffect } from "react";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { loadChatFromDb } from "@/features/ai/services/ai-chat-history-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { conversationContent, conversationMessages } from "../lib/snapshot-content";
import { fetchShareOptions, shareRequest, updateShare } from "../services/share-api";
import { getShareDeviceId } from "../services/share-device";
import type { ShareDraft } from "../types/share.types";

export function SharingRuntime() {
  const userId = useAuthStore((state) => state.user?.id);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deviceId = getShareDeviceId();
    const sent = new Map<string, string>();
    const requests = new Map<string, string>();
    const current = () => !cancelled && useAuthStore.getState().user?.id === userId;
    const sync = async () => {
      try {
        const token = await getAuthToken();
        if (!token || !current()) return;
        const options = await fetchShareOptions(token);
        if (!current()) return;
        const drafts = new Map<string, ShareDraft>();
        for (const summary of useAIChatStore.getState().chats) {
          if (
            !options.sessionsEnabled &&
            !options.items.some(
              (item) => item.live && item.sourceId === summary.id && item.deviceId === deviceId,
            )
          )
            continue;
          const chat = summary.messages.length ? summary : await loadChatFromDb(summary.id);
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
            title: summary.title,
            content,
            messages: conversationMessages(messages),
            language: "markdown",
            sourceId: summary.id,
            deviceId,
          });
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
            await shareRequest(
              "/api/cloud-sessions",
              {
                method: "POST",
                body: JSON.stringify({ ...draft, requestId, visibility: "private", live: true }),
              },
              token,
            );
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
        }
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
        if (current()) timer = setTimeout(() => void sync(), 3000);
      }
    };
    void sync();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);
  return null;
}
