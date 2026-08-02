import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { PlusIcon as Plus, TagIcon as Tag, UserIcon as User, XIcon as X } from "@/ui/icons";
import Input from "@/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { matchesSearchQuery } from "@/utils/search-match";
import type { Label } from "../types/github.types";

interface GitHubLabelPickerProps {
  labels: Label[];
  selectedNames: Set<string>;
  onChange: (value: Set<string>) => void;
  isLoading?: boolean;
}

export function GitHubLabelPicker({
  labels,
  selectedNames,
  onChange,
  isLoading = false,
}: GitHubLabelPickerProps) {
  const [query, setQuery] = useState("");
  const selectedLabels = useMemo(
    () => labels.filter((label) => selectedNames.has(label.name)),
    [labels, selectedNames],
  );
  const summary =
    selectedLabels.length === 0
      ? "Labels"
      : selectedLabels.length === 1
        ? selectedLabels[0]?.name
        : `${selectedLabels.length} labels`;

  return (
    <Combobox<Label, true>
      multiple
      items={labels}
      value={selectedLabels}
      onValueChange={(nextLabels) => {
        onChange(new Set(nextLabels.map((label) => label.name)));
      }}
      itemToStringLabel={(label) => label.name}
      itemToStringValue={(label) => label.name}
      isItemEqualToValue={(left, right) => left.name === right.name}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      filter={(label, searchQuery) => matchesSearchQuery(searchQuery, [label.name])}
      autoHighlight
      modal={false}
    >
      <div className="w-44 min-w-0">
        <ComboboxInput
          leftIcon={Tag}
          placeholder={summary}
          aria-label="Choose labels"
          size="xs"
          variant="ghost"
          className="w-full bg-transparent hover:bg-accent/60"
          inputClassName="truncate"
        />
      </div>
      <ComboboxContent className="min-w-72" data-prevent-dialog-escape="true">
        <ComboboxEmpty>{isLoading ? "Loading labels..." : "No matching labels"}</ComboboxEmpty>
        <ComboboxList>
          {(label: Label) => (
            <ComboboxItem key={label.name} value={label}>
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color ? `#${label.color}` : undefined }}
              />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

interface GitHubAssigneePickerProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function GitHubAssigneePicker({ value, onChange }: GitHubAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const summary =
    value.length === 0
      ? "Assignees"
      : value.length === 1
        ? `@${value[0]}`
        : `${value.length} people`;

  const addAssignees = () => {
    const nextValues = draft
      .split(/[,\s]+/)
      .map((item) => item.trim().replace(/^@/, ""))
      .filter(Boolean);
    if (nextValues.length === 0) return;
    onChange(Array.from(new Set([...value, ...nextValues])));
    setDraft("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="max-w-44 justify-start font-normal"
          />
        }
      >
        <User />
        <span className="truncate">{summary}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-2">
        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addAssignees();
              }
            }}
            placeholder="GitHub username"
            aria-label="Add assignee"
            size="sm"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={addAssignees}
            disabled={!draft.trim()}
            aria-label="Add assignee"
          >
            <Plus />
          </Button>
        </div>
        {value.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {value.map((assignee) => (
              <Button
                key={assignee}
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 bg-accent/55 font-normal"
                onClick={() => onChange(value.filter((item) => item !== assignee))}
                aria-label={`Remove @${assignee}`}
              >
                @{assignee}
                <X />
              </Button>
            ))}
          </div>
        ) : (
          <p className="px-1 text-subtle-foreground">
            Type one or more GitHub usernames, then press Enter.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
