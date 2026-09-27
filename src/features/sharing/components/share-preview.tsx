import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import type { ShareDraft } from "../types/share.types";

export function SharePreview({ draft }: { draft: ShareDraft }) {
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
