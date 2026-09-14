import { type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import Keybinding from "@/features/keymaps/components/keybinding";
import { Button } from "@/ui/button";
import { Composer } from "@/ui/composer";
import { Spinner } from "@/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import Textarea from "@/ui/textarea";
import { GitHubAvatar } from "./github-avatar";
import GitHubMarkdown from "./github-markdown";

interface GitHubCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<boolean>;
  isSubmitting: boolean;
  disabled?: boolean;
  placeholder?: string;
  currentUser?: string | null;
  repositoryUrl?: string;
  repoPath?: string;
  containerRef?: RefObject<HTMLDivElement | null>;
}

export function GitHubCommentComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  disabled = false,
  placeholder = "Write a comment…",
  currentUser,
  repositoryUrl,
  repoPath,
  containerRef,
}: GitHubCommentComposerProps) {
  const [mode, setMode] = useState("write");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  const hintId = useId();
  const busy = pending || isSubmitting;
  const canSubmit = !disabled && !busy && value.trim().length > 0;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [value, mode]);

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const saved = await onSubmit();
      if (saved) {
        setMode("write");
      } else {
        setError("Could not post your comment. Your draft is still here — try again.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div ref={containerRef} className="min-w-0 space-y-2">
      <Composer>
        <form
          aria-label="Add a comment"
          aria-busy={busy}
          className="p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }
          }}
        >
          <Tabs value={mode} onValueChange={(next) => setMode(String(next))}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <TabsList aria-label="Comment editor">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              {currentUser ? (
                <span className="flex min-w-0 items-center gap-1.5 text-subtle-foreground ui-text-sm">
                  <GitHubAvatar login={currentUser} displaySize="xs" />
                  <span className="truncate">{currentUser}</span>
                </span>
              ) : null}
            </div>
            <TabsContent value="write">
              <Textarea
                ref={inputRef}
                aria-label="Comment"
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                aria-invalid={Boolean(error)}
                value={value}
                onChange={(event) => {
                  onChange(event.target.value);
                  setError(null);
                }}
                placeholder={placeholder}
                rows={3}
                variant="ghost"
                resize="none"
                className="block min-h-20 max-h-64"
                disabled={disabled || busy}
                spellCheck
              />
            </TabsContent>
            <TabsContent value="preview">
              <div className="min-h-20 max-h-64 overflow-auto px-2 py-1">
                {value.trim() ? (
                  <GitHubMarkdown
                    content={value}
                    repositoryUrl={repositoryUrl}
                    repoPath={repoPath}
                  />
                ) : (
                  <p className="text-subtle-foreground ui-text-sm">Nothing to preview yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span
              id={hintId}
              className="flex flex-wrap items-center gap-2 text-subtle-foreground ui-text-sm"
            >
              Markdown supported
              <span className="inline-flex items-center gap-1">
                <Keybinding binding="mod+enter" /> to send
              </span>
            </span>
            <div className="ml-auto">
              <Button type="submit" disabled={!canSubmit}>
                {busy ? <Spinner label="Posting comment" compact /> : null}
                {busy ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        </form>
      </Composer>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive ui-text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
