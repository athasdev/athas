import type { ReactNode } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { Button } from "@/ui/button";
import { GitDiffIcon, GlobeIcon, SidebarRightIcon, TerminalIcon } from "@/ui/icons";
import { toggleSessionTool } from "../services/session-tools";
import { useSessionPanel, useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";

const HEADER_TOOLS: { tab: SessionPanelTab; label: string; command: string; icon: ReactNode }[] = [
  { tab: "changes", label: "Changes", command: "ai.showSessionChanges", icon: <GitDiffIcon /> },
  { tab: "terminal", label: "Terminal", command: "ai.showSessionTerminal", icon: <TerminalIcon /> },
  { tab: "browser", label: "Browser", command: "ai.showSessionBrowser", icon: <GlobeIcon /> },
];

function HeaderToolButton({
  chatId,
  tool,
  active,
}: {
  chatId: string;
  tool: (typeof HEADER_TOOLS)[number];
  active: boolean;
}) {
  const shortcut = useCommandShortcut(tool.command);
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      active={active}
      aria-pressed={active}
      aria-label={tool.label}
      tooltip={tool.label}
      shortcut={shortcut}
      onClick={() => toggleSessionTool(chatId, tool.tab)}
    >
      {tool.icon}
    </Button>
  );
}

/** The session header's way into its tools, and the switch that puts the boxes away. */
export function SessionHeaderTools({ chatId }: { chatId: string }) {
  const panel = useSessionPanel(chatId);
  const boxesHidden = useSessionPanelStore((state) => state.boxesHidden);
  const { toggleBoxesHidden } = useSessionPanelStore.use.actions();
  const isCloud = useAIChatStore((state) =>
    Boolean(state.chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud),
  );

  return (
    <>
      {(isCloud ? [] : HEADER_TOOLS).map((tool) => (
        <HeaderToolButton
          key={tool.tab}
          chatId={chatId}
          tool={tool}
          active={panel.open && panel.tab === tool.tab}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        iconOnly
        active={!boxesHidden}
        aria-pressed={!boxesHidden}
        aria-label="Session details"
        tooltip={boxesHidden ? "Show session details" : "Hide session details"}
        onClick={toggleBoxesHidden}
      >
        <SidebarRightIcon />
      </Button>
    </>
  );
}
