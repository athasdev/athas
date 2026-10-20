import type { ReactNode } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useDockLayoutStore, selectDockLayout } from "@/features/layout/stores/dock-layout.store";
import { Button } from "@/ui/button";
import { getProjectToolPaneId } from "@/features/layout/services/dock-pane-registry";
import { getSidebarViews } from "@/features/layout/services/sidebar-view-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { DotsIcon, GitDiffIcon, GlobeIcon, ListChecksIcon, TerminalIcon } from "@/ui/icons";
import { ChatConversationMenuItems } from "@/features/ai/components/chat/chat-header";
import { useHasSessionPlan, useSessionHasChanges } from "../hooks/use-session-tool-availability";
import { openSessionTool, toggleSessionTool } from "../services/session-tools";
import { StatusDot } from "@/ui/status-dot";
import { isAgentWindow } from "@/features/ai/detached/services/agent-window-service";
import { getSessionDockOwner, useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";

const HEADER_TOOLS: { tab: SessionPanelTab; label: string; command: string; icon: ReactNode }[] = [
  { tab: "changes", label: "Changes", command: "ai.showSessionChanges", icon: <GitDiffIcon /> },
  { tab: "terminal", label: "Terminal", command: "ai.showSessionTerminal", icon: <TerminalIcon /> },
  { tab: "browser", label: "Browser", command: "ai.showSessionBrowser", icon: <GlobeIcon /> },
];

function HeaderToolButton({
  chatId,
  tool,
}: {
  chatId: string;
  tool: (typeof HEADER_TOOLS)[number];
}) {
  const shortcut = useCommandShortcut(tool.command);
  const active = useDockLayoutStore(
    (state) =>
      !state.hidden &&
      selectDockLayout(state, getSessionDockOwner(chatId)).panes.includes(tool.tab),
  );
  const attention = useSessionPanelStore((state) => Boolean(state.attention[chatId]?.[tool.tab]));
  const hasChanges = useSessionHasChanges(chatId);
  const label = attention && !active ? `${tool.label}, has something new` : tool.label;
  if (tool.tab === "changes" && !hasChanges && !active && !attention) return null;
  return (
    <span className="relative flex">
      <Button
        type="button"
        variant="ghost"
        iconOnly
        active={active}
        aria-pressed={active}
        aria-label={label}
        tooltip={tool.label}
        shortcut={shortcut}
        onClick={() => toggleSessionTool(chatId, tool.tab)}
      >
        {tool.icon}
      </Button>
      {attention && !active ? <StatusDot tone="unread" placement="corner" /> : null}
    </span>
  );
}

/**
 * The session's other actions: its plan and the project tools (Files, Source Control, GitHub…),
 * opened in its dock, then the conversation's own actions.
 */
function SessionMoreActionsMenu({ chatId }: { chatId: string }) {
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const hasPlan = useHasSessionPlan(getSessionDockOwner(chatId));
  const tools = getSidebarViews().filter(
    (view) => view.isAvailable?.({ coreFeatures, hasTeamsCollaborationAccess: false }) ?? true,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label="More actions"
            tooltip="More actions"
          />
        }
      >
        <DotsIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="default">
        {hasPlan ? (
          <DropdownMenuItem onClick={() => openSessionTool(chatId, "plan", { focus: true })}>
            <ListChecksIcon />
            Plan
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Project tools</DropdownMenuLabel>
          {tools.map((tool) => (
            <DropdownMenuItem
              key={tool.id}
              onClick={() =>
                useDockLayoutStore
                  .getState()
                  .actions.open(getSessionDockOwner(chatId), getProjectToolPaneId(tool.id), {
                    focus: true,
                  })
              }
            >
              {tool.icon}
              {tool.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ChatConversationMenuItems chatId={chatId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The session header's way into its tools; the tab bar holds the switch that puts the dock away. */
export function SessionHeaderTools({ chatId }: { chatId: string }) {
  const isCloud = useAIChatStore((state) =>
    Boolean(state.chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud),
  );

  return (
    <>
      {(isCloud ? [] : HEADER_TOOLS)
        .filter((tool) => !isAgentWindow() || tool.tab === "changes")
        .map((tool) => (
          <HeaderToolButton key={tool.tab} chatId={chatId} tool={tool} />
        ))}
      <SessionMoreActionsMenu chatId={chatId} />
    </>
  );
}
