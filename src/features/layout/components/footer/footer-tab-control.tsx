import type { ReactNode, Ref } from "react";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import {
  chromeControl,
  chromeControlGroup,
} from "@/features/layout/components/chrome-control-styles";
import { Tab, TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
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
    chromeControl({ shape: "pill" }),
    "ui-font ui-text-sm font-medium",
    footerToneClassNames[tone],
    busy && "cursor-wait bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
  );
}

export function FooterControlBadge({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-h-3 min-w-3 items-center justify-center rounded-[var(--app-radius-pill)] bg-accent px-0.5 leading-3 text-primary-bg">
      {children}
    </span>
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
  controlRef,
  children,
}: {
  tooltip: string;
  active?: boolean;
  tone?: FooterControlTone;
  busy?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  commandId?: string;
  controlRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const shortcut = useCommandShortcut(commandId);

  return (
    <TabsList variant="segmented" className={chromeControlGroup()}>
      <Tooltip content={tooltip} shortcut={shortcut} side="top">
        <Tab
          ref={controlRef}
          role="button"
          aria-label={tooltip}
          tabIndex={0}
          isActive={active}
          size="xs"
          variant="segmented"
          className={footerControlClassName(tone, busy)}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick();
            }
          }}
        >
          {children}
        </Tab>
      </Tooltip>
    </TabsList>
  );
}
