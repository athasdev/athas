import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { ShareDraft } from "../types/share.types";

export function SharePreview({ draft }: { draft: ShareDraft }) {
  const user = useAuthStore((state) => state.user);
  return (
    <div className="max-h-72 overflow-auto" aria-label="Share preview">
      {draft.kind === "agent" ? (
        <div className="flex flex-col gap-5 py-2">
          {draft.messages?.map((message, index) => (
            <ChatMessage
              key={index}
              message={{ ...message, id: String(index), timestamp: new Date(0) }}
              isLastMessage={false}
              showActions={false}
              userName={user?.name || "You"}
              userAvatarUrl={user?.avatar_url}
              assistantIconId="athas"
              assistantLabel="Agent"
            />
          ))}
        </div>
      ) : (
        <pre className="font-mono ui-text-sm leading-relaxed" tabIndex={0}>
          <code>{draft.content}</code>
        </pre>
      )}
    </div>
  );
}
