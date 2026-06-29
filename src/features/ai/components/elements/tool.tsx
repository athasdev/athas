import { CaretRightIcon as CaretRight } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";

type ToolState = "running" | "success" | "error" | "info";

const stateClassNames: Record<ToolState, string> = {
  running: "bg-accent",
  success: "bg-success",
  error: "bg-error",
  info: "bg-text-lighter/60",
};

export function Tool({ className, ...props }: ComponentProps<"div">) {
  return <div data-ai-element="tool" className={cn("select-none", className)} {...props} />;
}

export function ToolTrigger({
  className,
  icon,
  title,
  detail,
  state = "info",
  expanded,
  canExpand,
  actions,
  ...props
}: ComponentProps<"button"> & {
  icon?: ReactNode;
  title: string;
  detail?: string | null;
  state?: ToolState;
  expanded?: boolean;
  canExpand?: boolean;
  actions?: ReactNode;
}) {
  const summary = detail ? `${title}: ${detail}` : title;
  const content = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", stateClassNames[state])} />
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center opacity-60">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
      {canExpand ? (
        <CaretRight
          size={12}
          className={cn("shrink-0 opacity-35 transition-transform", expanded && "rotate-90")}
        />
      ) : null}
    </>
  );

  if (!canExpand) {
    return (
      <div
        data-ai-element="tool-trigger"
        className={cn(
          "ui-font ui-text-sm flex h-6 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-0 text-text-lighter/55",
          className,
        )}
      >
        {content}
        {actions ? <span className="ml-1 shrink-0">{actions}</span> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-ai-element="tool-trigger"
      className={cn(
        "ui-font ui-text-sm flex h-6 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-0 text-text-lighter/55",
        "hover:bg-transparent hover:text-text-lighter/75 focus-visible:outline-none",
        className,
      )}
      aria-expanded={expanded}
      {...props}
    >
      {content}
    </button>
  );
}

export function ToolContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-ai-element="tool-content"
      className={cn(
        "ui-text-sm editor-font mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-text-lighter/45",
        className,
      )}
      {...props}
    />
  );
}
