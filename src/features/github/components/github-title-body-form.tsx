import { CheckIcon as Check, XIcon as X } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import Textarea from "@/ui/textarea";

interface GitHubTitleBodyFormProps {
  title: string;
  body: string;
  titlePlaceholder: string;
  bodyPlaceholder?: string;
  submitLabel: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSubmit: (value: { title: string; body: string }) => void;
}

export function GitHubTitleBodyForm({
  title,
  body,
  titlePlaceholder,
  bodyPlaceholder = "Description",
  submitLabel,
  isSubmitting = false,
  onCancel,
  onSubmit,
}: GitHubTitleBodyFormProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const canSubmit = draftTitle.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    setDraftTitle(title);
    setDraftBody(body);
  }, [body, title]);

  return (
    <form
      className="w-full space-y-2 rounded-[var(--app-radius-card)] border border-border/70 bg-secondary-bg/25 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({ title: draftTitle.trim(), body: draftBody });
      }}
    >
      <Input
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder={titlePlaceholder}
        size="sm"
        className="bg-primary-bg"
      />
      <Textarea
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        placeholder={bodyPlaceholder}
        className="min-h-44 resize-y bg-primary-bg"
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" compact onClick={onCancel} disabled={isSubmitting}>
          <X />
          Cancel
        </Button>
        <Button type="submit" variant="default" compact disabled={!canSubmit}>
          {isSubmitting ? <LoadingIndicator label={submitLabel} compact /> : <Check />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
