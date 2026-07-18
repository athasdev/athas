import type { ReactNode } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

type FooterControlTone = "default" | "accent" | "warning" | "danger";

const footerToneClassNames: Record<FooterControlTone, string> = {
  default: "",
  accent: "text-accent hover:text-accent",
  warning: "text-warning hover:text-warning",
  danger: "text-error hover:bg-error/10 hover:text-error",
};

export function footerControlClassName(tone: FooterControlTone = "default", busy = false) {
  return cn(
    "font-sans ui-text-sm font-medium",
    footerToneClassNames[tone],
    busy && "cursor-wait bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
  );
}

export function FooterControlBadge({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="accent"
      size="compact"
      className="min-h-3 min-w-3 px-0.5 leading-3 text-primary-bg"
    >
      {children}
    </Badge>
  );
}

export function FooterTabControl({
  tooltip,
  active = false,
  tone = "default",
  busy = false,
  onClick,
  onContextMenu,
  commandId,
  children,
}: {
  tooltip: string;
  active?: boolean;
  tone?: FooterControlTone;
  busy?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  commandId?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      active={active}
      tooltip={tooltip}
      tooltipSide="top"
      commandId={commandId}
      className={footerControlClassName(tone, busy)}
      aria-busy={busy}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </Button>
  );
}
