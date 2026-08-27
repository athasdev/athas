import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { DynamicIcon } from "./dynamic-icon";
import type { ExtensionViewExecute } from "./extension-view-controls";
import type { ExtensionViewActivityState, ExtensionViewNode } from "../types/extension-view";

type ActivityNode = Extract<ExtensionViewNode, { type: "activity" }>;

const stateClassNames: Record<ExtensionViewActivityState, string> = {
  default: "text-subtle-foreground/60",
  running: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

const markerTone = (state: ExtensionViewActivityState) =>
  state === "default" || state === "running" ? "default" : state;

export function ExtensionViewActivity({
  node,
  execute,
}: {
  node: ActivityNode;
  execute: ExtensionViewExecute;
}) {
  return (
    <div role="list" className="flex min-w-0 flex-col gap-1">
      {node.items.map((item, index) => {
        const state = item.state ?? "default";
        return (
          <div key={`${item.title}-${index}`} role="listitem">
            <Marker
              render={item.onSelect ? <button type="button" /> : undefined}
              tone={markerTone(state)}
              role={state === "running" ? "status" : undefined}
              onClick={() => item.onSelect && execute(item.onSelect)}
              className="min-w-0 py-0.5"
            >
              <MarkerIcon className={stateClassNames[state]}>
                {state === "running" ? (
                  <Spinner compact label={item.title} />
                ) : item.icon ? (
                  <DynamicIcon name={item.icon} size={14} />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </MarkerIcon>
              <MarkerContent className="flex min-w-0 flex-1 items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", item.onSelect && "text-foreground")}>
                    {item.title}
                  </span>
                  {item.description ? (
                    <span className="block wrap-break-word text-subtle-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {item.meta ? (
                  <span className="shrink-0 tabular-nums text-subtle-foreground">{item.meta}</span>
                ) : null}
              </MarkerContent>
            </Marker>
          </div>
        );
      })}
    </div>
  );
}
