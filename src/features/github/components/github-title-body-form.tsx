import { CheckIcon as Check, XIcon as X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
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
      className="w-full space-y-2 rounded-md border border-border/70 bg-secondary-bg/25 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({ title: draftTitle.trim(), body: draftBody });
      }}
    >
      <input
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder={titlePlaceholder}
        className="ui-font h-8 w-full min-w-0 rounded-md border border-border bg-primary-bg px-2 ui-text-sm text-text outline-none placeholder:text-text-lighter focus:border-accent/45"
      />
      <Textarea
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        placeholder={bodyPlaceholder}
        className="min-h-44 resize-y rounded-md bg-primary-bg"
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
