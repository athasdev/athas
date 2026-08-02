import type { ReactNode } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

type FooterControlTone = "default" | "accent" | "warning" | "danger";

const footerToneClassNames: Record<FooterControlTone, string> = {
  default: "",
  accent: "text-primary hover:text-primary",
  warning: "text-warning hover:text-warning",
  danger: "text-destructive hover:bg-destructive/10 hover:text-destructive",
};

function footerControlClassName(tone: FooterControlTone = "default", busy = false) {
  return cn(
    "font-sans ui-text-chrome font-normal",
    footerToneClassNames[tone],
    busy && "cursor-wait bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
  );
}

export function FooterControlBadge({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="accent"
      size="compact"
      className="min-h-3 min-w-3 px-0.5 leading-3 text-background"
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
