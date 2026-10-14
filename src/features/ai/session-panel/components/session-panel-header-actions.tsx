import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { Button } from "@/ui/button";
import { WrenchIcon } from "@/ui/icons";
import { useSessionPanel, useSessionPanelStore } from "../stores/session-panel.store";
import { SessionSignalPills, useSessionPillsPlacement } from "./session-signal-pills";

/**
 * Expands or collapses the session's tool card, after the session's pills when the session is
 * too narrow for them to float beside the conversation.
 */
export function SessionPanelHeaderActions({ chatId }: { chatId: string }) {
  const panel = useSessionPanel(chatId);
  const toggle = useSessionPanelStore.use.actions().toggle;
  const toggleShortcut = useCommandShortcut("ai.toggleSessionPanel");
  const placement = useSessionPillsPlacement();

  return (
    <>
      {placement === "header" ? <SessionSignalPills chatId={chatId} placement="header" /> : null}
      <Button
        type="button"
        variant="ghost"
        iconOnly
        active={panel.open}
        aria-pressed={panel.open}
        tooltip={panel.open ? "Hide session tools" : "Show session tools"}
        shortcut={toggleShortcut}
        onClick={() => toggle(chatId)}
      >
        <WrenchIcon />
      </Button>
    </>
  );
}
