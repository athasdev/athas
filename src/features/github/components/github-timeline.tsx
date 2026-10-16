import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * The activity of an issue or pull request: events and comments on one quiet connector, each
 * marked by an icon or the author's avatar.
 */
export function GitHubTimeline({ children }: { children: ReactNode }) {
  return (
    <ol className="relative space-y-5 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px before:bg-divider">
      {children}
    </ol>
  );
}

export function GitHubTimelineItem({ children }: { children: ReactNode }) {
  return <li className="relative min-w-0">{children}</li>;
}

/** The dot on the connector: an event icon or an avatar, masking the line behind it. */
export function GitHubTimelineMarker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-subtle-foreground [&_svg]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}
