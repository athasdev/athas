import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import GitHubMarkdown from "./github-markdown";
import { GitHubMarkdownEditor } from "./github-markdown-editor";

interface GitHubInlineTitleProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
}

export function GitHubInlineTitle({ value, onSave }: GitHubInlineTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [isEditing, value]);

  if (!isEditing) {
    return (
      <button
        type="button"
        className="block w-full rounded-lg text-left outline-none hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsEditing(true)}
        aria-label="Edit title"
      >
        <span className="block font-sans text-2xl leading-tight font-semibold tracking-tight text-foreground">
          {value}
        </span>
      </button>
    );
  }

  const save = async () => {
    const nextValue = draft.trim();
    if (!nextValue || nextValue === value) {
      setDraft(value);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    const saved = await onSave(nextValue);
    setIsSaving(false);
    if (saved) setIsEditing(false);
  };

  return (
    <div className="relative">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            cancelBlurRef.current = true;
            setDraft(value);
            setIsEditing(false);
          }
        }}
        variant="ghost"
        size="md"
        className="github-composer-title h-auto px-0 py-0.5 font-semibold tracking-tight"
        aria-label="Title"
        disabled={isSaving}
        autoFocus
      />
      {isSaving ? (
        <div className="absolute top-1/2 right-1 -translate-y-1/2">
          <Spinner label="Saving title" compact />
        </div>
      ) : null}
    </div>
  );
}

interface GitHubInlineMarkdownProps {
  value: string;
  emptyLabel: string;
  repositoryUrl?: string;
  repoPath?: string;
  onSave: (value: string) => Promise<boolean>;
}

export function GitHubInlineMarkdown({
  value,
  emptyLabel,
  repositoryUrl,
  repoPath,
  onSave,
}: GitHubInlineMarkdownProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [isEditing, value]);

  if (!isEditing) {
    return (
      <div
        role="button"
        tabIndex={0}
        className="min-h-12 rounded-lg outline-none hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          const interactiveTarget = (event.target as HTMLElement).closest(
            "a, button, input, [role='button']",
          );
          if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
          setIsEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsEditing(true);
          }
        }}
        aria-label="Edit description"
      >
        {value ? (
          <GitHubMarkdown
            content={value}
            className="github-markdown-pr w-full"
            contentClassName="github-markdown-pr-content w-full max-w-none"
            repositoryUrl={repositoryUrl}
            repoPath={repoPath}
          />
        ) : (
          <p className="font-sans ui-text-sm italic text-subtle-foreground">{emptyLabel}</p>
        )}
      </div>
    );
  }

  const save = async () => {
    if (draft === value) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    const saved = await onSave(draft);
    setIsSaving(false);
    if (saved) setIsEditing(false);
  };

  return (
    <div className="space-y-3">
      <GitHubMarkdownEditor
        value={draft}
        onChange={setDraft}
        placeholder="Write a description..."
        minHeight={220}
        autoFocus
        disabled={isSaving}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={isSaving}
          onClick={() => {
            setDraft(value);
            setIsEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="accent"
          size="xs"
          disabled={isSaving}
          onClick={() => void save()}
        >
          {isSaving ? <Spinner label="Saving" compact /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
