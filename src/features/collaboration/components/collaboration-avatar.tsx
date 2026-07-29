import Tooltip from "@/ui/tooltip";
import { getAvatarInitials } from "@/ui/avatar";
import { cn } from "@/utils/cn";

export function CollaborationAvatar({ name, online }: { name: string; online?: boolean }) {
  return (
    <span className="ui-text-sm relative flex size-7 shrink-0 items-center justify-center rounded-full bg-surface font-medium text-foreground">
      {getAvatarInitials(name)}
      {online !== undefined ? (
        <span
          className={cn(
            "-right-0.5 -bottom-0.5 absolute size-2 rounded-full border border-background bg-subtle-foreground/55",
            online && "bg-primary",
          )}
        />
      ) : null}
    </span>
  );
}

export function PresenceStatusDot({ online }: { online: boolean }) {
  if (!online) return null;

  return (
    <Tooltip content="Online" side="top">
      <span className="block size-2 rounded-full bg-primary" />
    </Tooltip>
  );
}
