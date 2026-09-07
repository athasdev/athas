import {
  type Icon,
  ArrowRightIcon,
  BugIcon,
  CheckCircleIcon,
  FileTextIcon,
  GitBranchIcon,
  PlayIcon,
  RocketIcon,
  SearchIcon,
  ShieldCheckIcon,
  StackIcon,
  TerminalIcon,
  UploadIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@/ui/icons";
import { memo } from "react";
import { MessageActions } from "@/ui/message";
import type { ChatFollowUpAction } from "@/features/ai/lib/follow-up-actions";
import { Button } from "@/ui/button";

interface ChatFollowUpActionsProps {
  actions: ChatFollowUpAction[];
  onSelect: (prompt: string) => void;
}

const ICONS = {
  ArrowRight: ArrowRightIcon,
  Bug: BugIcon,
  CheckCircle: CheckCircleIcon,
  FileText: FileTextIcon,
  GitBranch: GitBranchIcon,
  Play: PlayIcon,
  Rocket: RocketIcon,
  Search: SearchIcon,
  ShieldCheck: ShieldCheckIcon,
  Stack: StackIcon,
  Terminal: TerminalIcon,
  Upload: UploadIcon,
  WarningCircle: WarningCircleIcon,
  Wrench: WrenchIcon,
} as const satisfies Record<ChatFollowUpAction["icon"], Icon>;

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
  const Icon = ICONS[action.icon] || ArrowRightIcon;

  return (
    <Button
      type="button"
      variant="default"
      onClick={() => onSelect(action.prompt)}
      tooltip={action.prompt}
      aria-label={action.label}
    >
      <Icon className="size-3.5" />
      <span className="ui-text-sm">{action.label}</span>
    </Button>
  );
}
