import { CheckIcon as Check, XIcon as X } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import type { Label } from "../types/github.types";
import { GitHubMarkdownEditor } from "./github-markdown-editor";
import { GitHubAssigneePicker, GitHubLabelPicker } from "./github-metadata-pickers";

interface GitHubTitleBodyFormProps {
  title: string;
  body: string;
  titlePlaceholder: string;
  bodyPlaceholder?: string;
  labels: Label[];
  initialLabelNames: string[];
  initialAssignees: string[];
  submitLabel: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSubmit: (value: { title: string; body: string; labels: string[]; assignees: string[] }) => void;
}

export function GitHubTitleBodyForm({
  title,
  body,
  titlePlaceholder,
  bodyPlaceholder = "Description",
  labels,
  initialLabelNames,
  initialAssignees,
  submitLabel,
  isSubmitting = false,
  onCancel,
  onSubmit,
}: GitHubTitleBodyFormProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const [selectedLabels, setSelectedLabels] = useState(() => new Set(initialLabelNames));
  const [assignees, setAssignees] = useState(initialAssignees);
  const canSubmit = draftTitle.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    setDraftTitle(title);
    setDraftBody(body);
    setSelectedLabels(new Set(initialLabelNames));
    setAssignees(initialAssignees);
  }, [body, initialAssignees, initialLabelNames, title]);

  return (
    <form
      className="mx-auto w-full max-w-4xl pt-7 pb-16"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          title: draftTitle.trim(),
          body: draftBody,
          labels: Array.from(selectedLabels),
          assignees,
        });
      }}
    >
      <div className="pb-5">
        <Input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder={titlePlaceholder}
          variant="ghost"
          size="md"
          className="github-composer-title h-auto px-0 py-1 font-semibold tracking-tight"
          autoFocus
        />
      </div>
      <GitHubMarkdownEditor
        value={draftBody}
        onChange={setDraftBody}
        placeholder={bodyPlaceholder}
        minHeight={260}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-border/60 border-t py-3">
        <GitHubLabelPicker
          labels={labels}
          selectedNames={selectedLabels}
          onChange={setSelectedLabels}
        />
        <GitHubAssigneePicker value={assignees} onChange={setAssignees} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-t pt-3">
        <span className="font-sans ui-text-sm min-w-0 truncate text-subtle-foreground">
          Changes are saved to GitHub when you submit.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            <X />
            Cancel
          </Button>
          <Button type="submit" variant="accent" size="xs" disabled={!canSubmit}>
            {isSubmitting ? <Spinner label={submitLabel} compact /> : <Check />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
