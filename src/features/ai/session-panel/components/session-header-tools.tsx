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
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  GitDiffIcon,
  GlobeIcon,
  ListChecksIcon,
  SidebarRightIcon,
  TerminalIcon,
  WrenchIcon,
} from "@/ui/icons";
import { useHasSessionPlan } from "../hooks/use-session-tool-availability";
import { openSessionTool, toggleSessionTool } from "../services/session-tools";
import { StatusDot } from "@/ui/status-dot";
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

/** Plan and the project tools (Files, Source Control, GitHub…), opened in the session's dock. */
function MoreToolsMenu({ chatId }: { chatId: string }) {
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
            aria-label="More tools"
            tooltip="More tools"
          />
        }
      >
        <WrenchIcon />
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
      </DropdownMenuContent>
    </DropdownMenu>
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
      <MoreToolsMenu chatId={chatId} />
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
