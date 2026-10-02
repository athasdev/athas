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
      onUpdateQueuedMessage={vi.fn()}
      onRemoveQueuedMessage={vi.fn()}
      onSendQueuedMessageNow={vi.fn()}
      onStopStreaming={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Agent composer", () => {
  it.each(["roomy", "default"] as const)(
    "keeps one editable prompt and send action with no context at %s size",
    (size) => {
      const markup = renderComposer({ size });
      expect(markup.match(/role="textbox"/g)).toHaveLength(1);
      expect(markup).toContain('aria-label="Send message"');
      expect(markup).toContain('aria-label="AI preferences"');
      // Voice input stays out of the toolbar where this webview cannot provide it.
      expect(markup).not.toContain('aria-label="Start voice input"');
      expect(markup).toContain('aria-label="Change model"');
    },
  );

  it("keeps the toolbar and send action inside the prompt surface, after the text", () => {
    const markup = renderComposer();
    const surfaceStart = markup.indexOf('data-ai-element="prompt-input"');
    const textboxStart = markup.indexOf('role="textbox"');
    const toolbarStart = markup.indexOf('data-slot="composer-toolbar"');
    const sendStart = markup.indexOf('aria-label="Send message"');

    expect(surfaceStart).toBeGreaterThanOrEqual(0);
    expect(textboxStart).toBeGreaterThan(surfaceStart);
    expect(toolbarStart).toBeGreaterThan(textboxStart);
    expect(sendStart).toBeGreaterThan(toolbarStart);
  });

  it("summarizes attached files without exposing a chip for every filename", () => {
    const markup = renderComposer({ selectedFilesPaths: new Set(["/src/one.ts", "/src/two.ts"]) });
    expect(markup.match(/role="textbox"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Send message"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Review 2 files"');
    expect(markup).not.toContain('aria-label="Remove two.ts from context"');
    expect(markup.indexOf('aria-label="Review 2 files"')).toBeLessThan(
      markup.indexOf('role="textbox"'),
    );
  });

  it("turns send into stop while the agent is responding to an empty composer", () => {
    const markup = renderComposer({ isTyping: true, streamingMessageId: "response" });
    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
    // Queue and interrupt appear once there is something to send.
    expect(markup).not.toContain('aria-label="Send after current response"');
    expect(markup).not.toContain('aria-label="Interrupt and send now"');
  });

  it("offers stop before the first streamed token arrives", () => {
    const markup = renderComposer({ isTyping: true, streamingMessageId: null });
    expect(markup).toContain('aria-label="Stop generation"');
  });

  it("keeps one toolbar row: context, mode, model and settings", () => {
    const markup = renderComposer({ currentAgentId: "custom" });
    const toolbar = markup.slice(markup.indexOf('data-slot="composer-toolbar"'));
    expect(toolbar).toContain('aria-label="Add context"');
    expect(toolbar).toContain('aria-label="Mode: Agent"');
    expect(toolbar).toContain('aria-label="Change model"');
    // A new chat carries only the agent's instructions; a ring there reads as a spinner.
    expect(toolbar).not.toContain('aria-label="Context window: ');
    expect(toolbar).not.toContain('aria-label="Show slash commands"');
    expect(toolbar).not.toContain('aria-label="Reasoning effort"');
    expect(toolbar).not.toContain("Follow the agent in the editor");
  });
});
