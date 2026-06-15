import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

function getCollaborationInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function CollaborationAvatar({ name, online }: { name: string; online?: boolean }) {
  return (
    <span className="ui-text-xs relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-bg font-medium text-text">
      {getCollaborationInitials(name)}
      {online !== undefined ? (
        <span
          className={cn(
            "-right-0.5 -bottom-0.5 absolute size-2 rounded-full border border-primary-bg bg-text-lighter/55",
            online && "bg-accent",
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
      <span className="block size-2 rounded-full bg-accent" />
    </Tooltip>
  );
}
