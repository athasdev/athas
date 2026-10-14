import { getToolCallPhase, summarizeToolCall } from "@/features/ai/lib/tool-call-summary";
import { useAcpTerminalsStore } from "@/features/ai/stores/acp-terminals.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Message, ToolCall } from "@/features/ai/types/ai-chat.types";
import { useHostedBrowserRunsStore } from "@/features/browser-use/stores/hosted-browser-runs.store";
import { detectLocalPorts } from "@/features/previews/services/detect-local-ports";
import { previewsStoreDependencies } from "@/features/previews/stores/previews.store";
import { subscribeToTerminalEvents } from "@/features/terminal/services/terminal-protocol";
import { onAppEvent } from "@/utils/app-events";
import {
  getSessionBrowserPageId,
  getSessionTerminalChatId,
  getSessionTerminalId,
  selectSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";
import { createDevServerAutoOpener, createTypingTracker } from "./dev-server-auto-open";
import { collectText, extractLocalServerUrls, getLocalServerPort } from "./dev-server-urls";

const SCAN_DELAY_MS = 400;
/** Recent messages hold the tool calls still running; older ones were scanned already. */
const SCANNED_MESSAGES = 4;
/** Text kept from the previous output chunk, so an address split across chunks is still found. */
const CHUNK_OVERLAP = 256;
const COMMAND_TOOL = /bash|shell|terminal|command|process|exec|output/i;

function toTime(value: Date | number | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime() || 0;
  return 0;
}

/** Tool calls that run commands, whose output can announce a server. */
function isCommandToolCall(toolCall: ToolCall) {
  return summarizeToolCall(toolCall).kind === "execute" || COMMAND_TOOL.test(toolCall.name);
}

function isPanelShowing(chatId: string, tab: SessionPanelTab) {
  const panel = selectSessionPanel(useSessionPanelStore.getState(), chatId);
  return panel.open && panel.tab === tab;
}

/**
 * Follows every agent session for what its panel should react to: a dev server its commands
 * started (the Browser opens once per session), a failed command in its terminal (the Terminal
 * tab is marked) or run by the agent (the Activity tab is marked), and an agent using the hosted
 * browser (the Browser tab is marked). It reads the session stores instead of the views, so a
 * session reacts while it is not on screen.
 */
export function startSessionPanelRuntime(): () => void {
  const startedAt = Date.now();
  const typing = createTypingTracker(window);
  const panelActions = useSessionPanelStore.getState().actions;

  const opener = createDevServerAutoOpener({
    isReachable: async (url) => {
      const port = getLocalServerPort(url);
      if (port === null) return false;
      return (await detectLocalPorts(previewsStoreDependencies.fetch, [port])).length > 0;
    },
    isUserTyping: typing.isTyping,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hasAutoOpened: (chatId) =>
      selectSessionPanel(useSessionPanelStore.getState(), chatId).autoOpened,
    markReachable: (chatId, url) => panelActions.markServerLive(chatId, url),
    open: (chatId, url) => {
      const before = selectSessionPanel(useSessionPanelStore.getState(), chatId).browserUrl;
      if (!panelActions.openForDevServer(chatId, url) || before) return;
      void import("@/features/browser/services/browser-tab-manager").then(({ browserTabManager }) =>
        browserTabManager.navigate(getSessionBrowserPageId(chatId), url),
      );
    },
  });

  const report = (chatId: string, text: string) => {
    for (const url of extractLocalServerUrls(text)) {
      panelActions.recordServer(chatId, url);
      void opener.consider(chatId, url);
    }
  };

  const scannedMessages = new Map<string, Message[]>();
  const scannedOutput = new Map<string, number>();
  const reportedFailures = new Set<string>();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const scanChats = () => {
    scanTimer = null;
    const { messagesByChat } = useAIChatStore.getState();
    for (const [chatId, messages] of Object.entries(messagesByChat)) {
      if (scannedMessages.get(chatId) === messages) continue;
      scannedMessages.set(chatId, messages);
      for (const message of messages.slice(-SCANNED_MESSAGES)) {
        for (const toolCall of message.toolCalls ?? []) {
          if (toTime(toolCall.timestamp) < startedAt || !isCommandToolCall(toolCall)) continue;
          const key = `${chatId}:${toolCall.id}`;
          if (
            getToolCallPhase(toolCall, message.isStreaming) === "failed" &&
            !reportedFailures.has(key)
          ) {
            reportedFailures.add(key);
            if (!isPanelShowing(chatId, "activity")) panelActions.markAttention(chatId, "activity");
          }
          const text = collectText([toolCall.output, toolCall.rawOutput, toolCall.terminals]);
          if (scannedOutput.get(key) === text.length) continue;
          scannedOutput.set(key, text.length);
          report(chatId, text);
        }
      }
    }
  };

  const stopChats = useAIChatStore.subscribe((state, previous) => {
    if (state.messagesByChat === previous.messagesByChat || scanTimer) return;
    scanTimer = setTimeout(scanChats, SCAN_DELAY_MS);
  });

  const terminalOutputLengths = new Map<string, number>();
  const stopAcpTerminals = useAcpTerminalsStore.subscribe((state, previous) => {
    if (state.terminals === previous.terminals) return;
    for (const [terminalId, terminal] of Object.entries(state.terminals)) {
      if (terminal === previous.terminals[terminalId]) continue;
      const seen = terminalOutputLengths.get(terminalId) ?? 0;
      if (terminal.output.length <= seen) continue;
      terminalOutputLengths.set(terminalId, terminal.output.length);
      const chat = useAIChatStore
        .getState()
        .chats.find((candidate) => candidate.acpSessionId === terminal.sessionId);
      if (chat) report(chat.id, terminal.output.slice(Math.max(0, seen - CHUNK_OVERLAP)));
    }
  });

  const terminalStreams = new Map<string, () => void>();
  const stopTerminalReady = onAppEvent("terminal:ready", ({ terminalId, connectionId }) => {
    const chatId = getSessionTerminalChatId(terminalId);
    if (!chatId) return;
    terminalStreams.get(terminalId)?.();
    const decoder = new TextDecoder();
    let tail = "";
    const unsubscribe = subscribeToTerminalEvents(connectionId, (event) => {
      if (event.event !== "output") return;
      const text = tail + decoder.decode(event.data, { stream: true });
      tail = text.slice(-CHUNK_OVERLAP);
      report(chatId, text);
    });
    terminalStreams.set(terminalId, unsubscribe);
  });

  const stopCommandFinished = onAppEvent("terminal:command-finished", ({ terminalId, command }) => {
    const chatId = getSessionTerminalChatId(terminalId);
    if (!chatId || command.status !== "failure" || isPanelShowing(chatId, "terminal")) return;
    const { terminalGeneration } = selectSessionPanel(useSessionPanelStore.getState(), chatId);
    // A terminal moved into an editor tab reports its failures there.
    if (terminalId !== getSessionTerminalId(chatId, terminalGeneration)) return;
    panelActions.markAttention(chatId, "terminal");
  });

  const stopHostedRuns = useHostedBrowserRunsStore.subscribe((state, previous) => {
    for (const chatId of Object.keys(state.runs)) {
      if (previous.runs[chatId] || isPanelShowing(chatId, "browser")) continue;
      panelActions.markAttention(chatId, "browser");
    }
  });

  return () => {
    if (scanTimer) clearTimeout(scanTimer);
    typing.dispose();
    stopChats();
    stopAcpTerminals();
    stopTerminalReady();
    stopCommandFinished();
    stopHostedRuns();
    for (const unsubscribe of terminalStreams.values()) unsubscribe();
    terminalStreams.clear();
  };
}
