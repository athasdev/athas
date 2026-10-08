import {
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  ChatBubbleTextIcon,
  CheckIcon,
  CrosshairIcon,
  GitDiffIcon,
  HistoryIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SparkleIcon,
  TerminalWindowIcon,
  XIcon,
} from "@/ui/icons";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { Command } from "../types/keymaps.types";

/** Loaded on use, so the keymap layer does not pull in the agent edit review up front. */
async function agentHunkActions() {
  return import("@/features/editor/agent-edits/agent-hunk-actions");
}

const aiActions = () => import("./ai-command-actions");

export const agentEditCommands: Command[] = [
  {
    id: "ai.openChatTranscript",
    title: "Open Conversation as Markdown",
    category: "Agent",
    description: "Open a local snapshot of the conversation and its tool activity",
    execute: async () => {
      const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
      const { openChatTranscript } = await import("@/features/ai/services/chat-transcript-service");
      const active = useBufferStore.getState().actions.getActiveBuffer();
      const chatId =
        active?.type === "agent" ? active.sessionId : useAIChatStore.getState().currentChatId;
      if (chatId) await openChatTranscript(chatId);
    },
  },
  {
    id: "ai.reviewAgentChanges",
    title: "Review Agent Changes",
    category: "Agent",
    description: "Review and keep or reject agent edits across files",
    execute: async () => {
      const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
      const { openAgentEditsReview } = await import("@/features/ai/services/agent-edits-service");
      const active = useBufferStore.getState().actions.getActiveBuffer();
      const chatId =
        active?.type === "agent" ? active.sessionId : useAIChatStore.getState().currentChatId;
      if (chatId) openAgentEditsReview(chatId);
    },
  },
  {
    id: "ai.keepAgentHunk",
    title: "Keep Agent Change",
    category: "AI",
    description: "Keep the unreviewed agent change at the cursor",
    icon: <CheckIcon />,
    palette: { label: "AI: Keep Agent Change" },
    execute: async () => {
      await (await agentHunkActions()).keepAgentHunkAtCursor();
    },
  },
  {
    id: "ai.rejectAgentHunk",
    title: "Undo Agent Change",
    category: "AI",
    description: "Undo the unreviewed agent change at the cursor",
    icon: <XIcon />,
    palette: { label: "AI: Undo Agent Change" },
    execute: async () => {
      await (await agentHunkActions()).rejectAgentHunkAtCursor();
    },
  },
];

export const aiCommands: Command[] = [
  {
    id: "ai.openAgentInNewWindow",
    title: "AI: Open Agent in New Window",
    category: "AI",
    description: "Open the active agent session in its own window",
    icon: <SparkleIcon />,
    palette: true,
    execute: async () => (await aiActions()).openActiveAgentInNewWindow(),
  },
  {
    id: "ai.toggleFollowAgent",
    title: "AI: Toggle Follow Agent",
    category: "AI",
    description: "Open the files the agent works in while its turn runs",
    icon: <CrosshairIcon />,
    palette: true,
    execute: async () => (await aiActions()).toggleFollowActiveAgent(),
  },
  {
    id: "ai.cycleAgentMode",
    title: "AI: Cycle Agent Mode",
    category: "AI",
    description: "Switch the current chat between Agent, Ask and Plan",
    icon: <ChatBubbleTextIcon />,
    palette: true,
    execute: async () => (await aiActions()).cycleActiveAgentMode(),
  },
  {
    id: "ai.reviewPendingAgentChanges",
    title: "AI: Review Agent Changes",
    category: "AI",
    description: "Keep or reject the agent's file edits hunk by hunk",
    icon: <GitDiffIcon />,
    palette: true,
    execute: async () => (await aiActions()).reviewPendingAgentChanges(),
  },
  {
    id: "ai.keepAllAgentChanges",
    title: "AI: Keep All Agent Changes",
    category: "AI",
    description: "Accept every unreviewed edit the agent made",
    icon: <CheckIcon />,
    palette: true,
    execute: async () => (await aiActions()).keepAllPendingAgentChanges(),
  },
  {
    id: "ai.rejectAllAgentChanges",
    title: "AI: Reject All Agent Changes",
    category: "AI",
    description: "Revert every unreviewed edit the agent made",
    icon: <XIcon />,
    palette: true,
    execute: async () => (await aiActions()).rejectAllPendingAgentChanges(),
  },
  {
    id: "ai.openContinuousAgents",
    title: "AI: Continuous Agents",
    category: "AI",
    description: "Create and manage recurring workspace goals",
    icon: <ArrowsClockwiseIcon />,
    palette: true,
    execute: () => {
      useBufferStore.getState().actions.openContinuousAgentsBuffer();
    },
  },
  {
    id: "ai.manageAllowedCommands",
    title: "AI: Manage Allowed Commands",
    category: "AI",
    description: "Review the commands and MCP tools the Athas agent runs without asking",
    icon: <ShieldCheckIcon />,
    palette: true,
    execute: () => {
      useUIState.getState().openSettings("ai-agents", "Allowed Commands");
    },
  },
  {
    id: "ai.openAcpInspector",
    title: "AI: Open ACP Inspector",
    category: "AI",
    description: "Inspect the JSON-RPC traffic and capabilities of running ACP agents",
    icon: <ArrowsLeftRightIcon />,
    palette: true,
    execute: () => {
      useBufferStore.getState().actions.openAcpInspectorBuffer();
    },
  },
  {
    id: "ai.importAgentSession",
    title: "AI: Import Agent Session",
    category: "AI",
    description: "Browse the agent's sessions for this workspace and open one",
    icon: <HistoryIcon />,
    when: ({ agent }) => agent.browseSessionsAgentId !== null,
    palette: true,
    execute: async () => (await aiActions()).importAgentSession(),
  },
  {
    id: "ai.openAgentCliInTerminal",
    title: "AI: Open Agent CLI in Terminal",
    category: "AI",
    icon: <TerminalWindowIcon />,
    when: ({ agent }) => agent.cli !== null,
    palette: ({ agent }) => ({
      label: `AI: Open ${agent.cli?.name} in Terminal`,
      description: `Run the ${agent.cli?.command} CLI in a terminal instead of the chat`,
    }),
    execute: async () => (await aiActions()).openCurrentAgentCliInTerminal(),
  },
  {
    id: "ai.logOutOfAgent",
    title: "AI: Log Out of Agent",
    category: "AI",
    description: "Sign out of the running agent; the next prompt asks how to sign in",
    icon: <SignOutIcon />,
    when: ({ agent }) => agent.logOutAgentId !== null,
    palette: true,
    execute: async () => (await aiActions()).logOutOfCurrentAgent(),
  },
];
