import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import AIChatInputBar from "../components/input/chat-input-bar";
import type { AIChatInputBarProps } from "../types/ai-chat.types";

vi.mock("../hooks/use-voice-input", () => ({
  useVoiceInput: () => ({
    isListening: false,
    interimTranscript: "",
    isSupported: false,
    isMacDevBlocked: false,
    toggle: vi.fn(),
  }),
}));

function renderComposer(overrides: Partial<AIChatInputBarProps> = {}) {
  return renderToStaticMarkup(
    <AIChatInputBar
      surfaceId="composer-test"
      buffers={[]}
      allProjectFiles={[]}
      currentAgentId="codex"
      isTyping={false}
      streamingMessageId={null}
      queuedMessages={[]}
      selectedBufferIds={new Set()}
      selectedFilesPaths={new Set()}
      selectedEditorContexts={[]}
      onToggleBufferSelection={vi.fn()}
      onToggleFileSelection={vi.fn()}
      onSetSelectedBufferIds={vi.fn()}
      onSetSelectedFilesPaths={vi.fn()}
      onRemoveEditorContext={vi.fn()}
      onSendMessage={() => ({ accepted: true })}
      onInterruptAndSend={() => ({ accepted: true })}
      onMoveQueuedMessage={vi.fn()}
      onRemoveQueuedMessage={vi.fn()}
      onStopStreaming={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Agent composer", () => {
  it.each(["initial", "default"] as const)(
    "keeps one editable prompt and send action with no context in %s presentation",
    (presentation) => {
      const markup = renderComposer({ presentation });
      expect(markup.match(/role="textbox"/g)).toHaveLength(1);
      expect(markup).toContain('aria-label="Send message"');
      expect(markup).toContain('aria-label="AI preferences"');
      expect(markup).toContain('aria-label="Start voice input"');
      expect(markup).toContain('aria-label="Change model"');
    },
  );

  it("keeps context attachments separate from the single prompt and toolbar", () => {
    const markup = renderComposer({ selectedFilesPaths: new Set(["/src/one.ts", "/src/two.ts"]) });
    expect(markup.match(/role="textbox"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Send message"/g)).toHaveLength(1);
    expect(markup.indexOf('aria-label="Remove two.ts from context"')).toBeLessThan(
      markup.indexOf('role="textbox"'),
    );
  });

  it("exposes queue, interrupt and stop while the agent is responding", () => {
    const markup = renderComposer({ isTyping: true, streamingMessageId: "response" });
    expect(markup).toContain('aria-label="Send after current response"');
    expect(markup).toContain('aria-label="Interrupt and send now"');
    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
  });
});
