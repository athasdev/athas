import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import Badge from "@/ui/badge";
import { ArrowRightIcon as ArrowRight, ArrowsClockwiseIcon as Continuous } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import { useContinuousAgentsStore } from "./continuous-agents.store";

export function ContinuousAgentsCallout() {
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const tasks = useContinuousAgentsStore((state) => state.tasks);
  const openContinuousAgentsBuffer = useBufferStore.use.actions().openContinuousAgentsBuffer;
  const activeCount = useMemo(
    () => tasks.filter((task) => task.workspacePath === workspacePath && task.enabled).length,
    [tasks, workspacePath],
  );

  return (
    <Item
      render={<button type="button" />}
      variant="outline"
      className="w-full text-left"
      onClick={openContinuousAgentsBuffer}
      aria-label="Try Continuous Agents"
      data-slot="continuous-agents-callout"
    >
      <ItemMedia variant="icon" className="text-primary">
        <Continuous />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {activeCount > 0 ? "Continuous Agents" : "Try Continuous Agents"}
          {activeCount > 0 ? (
            <Badge variant="success">{activeCount} active</Badge>
          ) : (
            <Badge variant="accent">New</Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          Set a goal once. Athas keeps moving it forward in fresh Agent sessions.
        </ItemDescription>
      </ItemContent>
      <ItemActions className="text-subtle-foreground">
        <ArrowRight />
      </ItemActions>
    </Item>
  );
}
