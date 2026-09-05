import { Button } from "@/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/ui/dropdown";
import { DotsThreeIcon, PenIcon, PlayIcon, TrashIcon } from "@/ui/icons";
import type { RunActionItem } from "../types/run-action.types";

interface RunActionRowProps {
  action: RunActionItem;
  onRun: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function RunActionRow({ action, onRun, onEdit, onDelete }: RunActionRowProps) {
  return (
    <DropdownMenuItem
      data-run-action=""
      onClick={onRun}
      aria-label={`Run ${action.name}`}
      title={action.command ?? action.description ?? action.name}
      trailingAction={
        onEdit || onDelete ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              appearance="action"
              render={
                <Button
                  variant="ghost"
                  iconOnly
                  size="chrome"
                  aria-label={`Options for ${action.name}`}
                />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-44">
              {onEdit ? (
                <DropdownMenuItem onClick={onEdit}>
                  <PenIcon />
                  Edit action…
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon />
                  Delete action…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : undefined
      }
    >
      <PlayIcon />
      <span className="min-w-0 flex-1 truncate">{action.name}</span>
    </DropdownMenuItem>
  );
}
