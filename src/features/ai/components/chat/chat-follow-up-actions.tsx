import {
  ArrowRightIcon as ArrowRight,
  BugIcon as Bug,
  CheckCircleIcon as CheckCircle,
  FileTextIcon as FileText,
  GitBranchIcon as GitBranch,
  MagnifyingGlassIcon as MagnifyingGlass,
  PlayIcon as Play,
  RocketLaunchIcon as RocketLaunch,
  ShieldCheckIcon as ShieldCheck,
  StackIcon as Stack,
  TerminalIcon as Terminal,
  UploadSimpleIcon as UploadSimple,
  WarningCircleIcon as WarningCircle,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { memo } from "react";
import { MessageActions } from "@/features/ai/components/elements/message";
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
    <MessageActions className="opacity-100">
      {actions.map((action) => (
        <FollowUpButton key={action.id} action={action} onSelect={onSelect} />
      ))}
    </MessageActions>
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
