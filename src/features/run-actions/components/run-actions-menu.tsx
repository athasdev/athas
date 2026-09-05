import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  DropdownMenuContent,
  DropdownMenuFooter,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { ArrowClockwiseIcon, PlusIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";
import type { RunActionItem } from "../types/run-action.types";
import RunActionRow from "./run-action-row";

interface RunActionsMenuProps {
  customActions: RunActionItem[];
  projectActions: RunActionItem[];
  lspActions: RunActionItem[];
  isDiscovering: boolean;
  discoveryError: string | null;
  canRefresh: boolean;
  onRefresh: () => void;
  onRun: (action: RunActionItem) => void;
  onCreate: () => void;
  onEdit: (action: RunActionItem) => void;
  onDelete: (action: RunActionItem) => void;
}

export default function RunActionsMenu({
  customActions,
  projectActions,
  lspActions,
  isDiscovering,
  discoveryError,
  canRefresh,
  onRefresh,
  onRun,
  onCreate,
  onEdit,
  onDelete,
}: RunActionsMenuProps) {
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const projectGroups = new Map<string, RunActionItem[]>();
    for (const action of projectActions) {
      const actions = projectGroups.get(action.sourceLabel) ?? [];
      actions.push(action);
      projectGroups.set(action.sourceLabel, actions);
    }

    return [
      { id: "custom", label: "Your actions", actions: customActions },
      { id: "lsp", label: "Current file", actions: lspActions },
      ...Array.from(projectGroups, ([label, actions]) => ({
        id: `project:${label}`,
        label,
        actions,
      })),
    ]
      .map((group) => ({
        ...group,
        actions: group.actions.filter((action) =>
          matchesSearchQuery(query, [
            action.name,
            action.command ?? "",
            action.description ?? "",
            action.sourceLabel,
          ]),
        ),
      }))
      .filter((group) => group.actions.length > 0);
  }, [customActions, lspActions, projectActions, query]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>("[data-run-action]");
    if (!items?.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const item = items[event.key === "ArrowDown" ? 0 : items.length - 1];
      item?.focus();
      item?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[0]?.click();
    }
  };

  return (
    <DropdownMenuContent
      ref={menuRef}
      align="end"
      viewport="searchable"
      className="w-64"
      aria-label="Run actions"
    >
      <DropdownMenuSearch
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search actions"
        autoFocus
      />
      <DropdownMenuViewport>
        {groups.map((group) => (
          <DropdownMenuGroup key={group.id}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.actions.map((action) => (
              <RunActionRow
                key={action.id}
                action={action}
                onRun={() => onRun(action)}
                onEdit={action.source === "custom" ? () => onEdit(action) : undefined}
                onDelete={action.source === "custom" ? () => onDelete(action) : undefined}
              />
            ))}
          </DropdownMenuGroup>
        ))}
        {groups.length === 0 ? (
          <DropdownMenuItem disabled>
            {isDiscovering ? (
              <>
                <Spinner compact />
                Finding commands…
              </>
            ) : query.trim() ? (
              "No actions match"
            ) : (
              "No actions found"
            )}
          </DropdownMenuItem>
        ) : null}
        {discoveryError ? (
          <DropdownMenuLabel className="whitespace-normal" role="status">
            {discoveryError}
          </DropdownMenuLabel>
        ) : null}
      </DropdownMenuViewport>
      <DropdownMenuFooter>
        <DropdownMenuItem onClick={onCreate}>
          <PlusIcon />
          New action…
        </DropdownMenuItem>
        <DropdownMenuItem
          closeOnClick={false}
          disabled={isDiscovering || !canRefresh}
          onClick={onRefresh}
        >
          {isDiscovering ? <Spinner compact /> : <ArrowClockwiseIcon />}
          {isDiscovering ? "Scanning project…" : "Refresh actions"}
        </DropdownMenuItem>
      </DropdownMenuFooter>
    </DropdownMenuContent>
  );
}
