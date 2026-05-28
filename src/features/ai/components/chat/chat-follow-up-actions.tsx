import {
  ArrowRight,
  Bug,
  CheckCircle,
  FileText,
  GitBranch,
  MagnifyingGlass,
  Play,
  RocketLaunch,
  ShieldCheck,
  Stack,
  Terminal,
  UploadSimple,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { memo } from "react";
import type { ChatFollowUpAction } from "@/features/ai/lib/follow-up-actions";
import { Button } from "@/ui/button";

interface ChatFollowUpActionsProps {
  actions: ChatFollowUpAction[];
  onSelect: (prompt: string) => void;
}

const ICONS = {
  ArrowRight,
  Bug,
  CheckCircle,
  FileText,
  GitBranch,
  MagnifyingGlass,
  Play,
  RocketLaunch,
  ShieldCheck,
  Stack,
  Terminal,
  UploadSimple,
  WarningCircle,
  Wrench,
} as const;

export const ChatFollowUpActions = memo(function ChatFollowUpActions({
  actions,
  onSelect,
}: ChatFollowUpActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {actions.map((action) => (
        <FollowUpButton key={action.id} action={action} onSelect={onSelect} />
      ))}
    </div>
  );
});

function FollowUpButton({
  action,
  onSelect,
}: {
  action: ChatFollowUpAction;
  onSelect: (prompt: string) => void;
}) {
  const Icon = ICONS[action.icon] || ArrowRight;

  return (
    <Button
      type="button"
      variant="ghost"
      compact
      onClick={() => onSelect(action.prompt)}
      className="h-7 rounded-md border border-border/70 bg-primary-bg/70 px-2 text-text-lighter hover:border-border-strong hover:bg-hover/70 hover:text-text"
      tooltip={action.prompt}
      aria-label={action.label}
    >
      <Icon className="size-3.5" />
      <span className="ui-text-xs">{action.label}</span>
    </Button>
  );
}
