import type { ReactNode } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useDockLayoutStore, selectDockLayout } from "@/features/layout/stores/dock-layout.store";
import { Button } from "@/ui/button";
import { GitDiffIcon, GlobeIcon, SidebarRightIcon, TerminalIcon } from "@/ui/icons";
import { StatusDot } from "@/ui/status-dot";
import { toggleSessionTool } from "../services/session-tools";
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
  const label = attention && !active ? `${tool.label}, has something new` : tool.label;
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

/** The session header's way into its tools, and the switch that puts the dock away. */
export function SessionHeaderTools({ chatId }: { chatId: string }) {
  const hidden = useDockLayoutStore.use.hidden();
  const { setHidden } = useDockLayoutStore.use.actions();
  const shortcut = useCommandShortcut("ai.toggleSessionPanel");
  const isCloud = useAIChatStore((state) =>
    Boolean(state.chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud),
  );

  return (
    <>
      {(isCloud ? [] : HEADER_TOOLS).map((tool) => (
        <HeaderToolButton key={tool.tab} chatId={chatId} tool={tool} />
      ))}
      <Button
        type="button"
        variant="ghost"
        iconOnly
        active={!hidden}
        aria-pressed={!hidden}
        aria-label="Session dock"
        tooltip={hidden ? "Show the session dock" : "Hide the session dock"}
        shortcut={shortcut}
        onClick={() => setHidden(!hidden)}
      >
        <SidebarRightIcon />
      </Button>
    </>
  );
}
