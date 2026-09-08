import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ui/field";
import { ResourceViewerBody } from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { GitHubMarkdownEditor } from "../../components/github-markdown-editor";
import { ViewerErrorState } from "@/features/viewer/components/viewer-state";
import type { Release, ReleaseInput } from "../types/github-delivery.types";

export function ReleaseEditor({
  repoPath,
  release,
  onSave,
  onCancel,
}: {
  repoPath: string;
  release?: Release;
  onSave: (release: Release) => void;
  onCancel?: () => void;
}) {
  const fieldId = useId();
  const draftKey = `athas:release-draft:${JSON.stringify([repoPath, release?.id ?? "new"])}`;
  const [input, setInput] = useState<ReleaseInput>(() => {
    const initial = {
      tag_name: release?.tag_name ?? "",
      target_commitish: release?.target_commitish ?? "",
      name: release?.name ?? "",
      body: release?.body ?? "",
      prerelease: release?.prerelease ?? false,
    };
    try {
      const stored = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      if (
        stored &&
        typeof stored.tag_name === "string" &&
        typeof stored.target_commitish === "string" &&
        typeof stored.name === "string" &&
        typeof stored.body === "string" &&
        typeof stored.prerelease === "boolean"
      )
        return stored;
    } catch {
      /* Unavailable session storage should not prevent editing. */
    }
    return initial;
  });
  const [previousTag, setPreviousTag] = useState("");
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const valid = Boolean(input.tag_name.trim() && input.target_commitish.trim());
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(input));
    } catch {
      /* Draft remains available in memory. */
    }
  }, [draftKey, input]);
  const removeDraft = () => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Session storage is optional. */
    }
  };
  const save = async () => {
    if (!valid || pending.current) return;
    pending.current = true;
    setBusy("save");
    setError(null);
    try {
      const saved = await invoke<Release>("github_save_release", {
        repoPath,
        id: release?.id ?? null,
        input: {
          ...input,
          tag_name: input.tag_name.trim(),
          target_commitish: input.target_commitish.trim(),
        },
      });
      removeDraft();
      onSave(saved);
    } catch (error) {
      setError(String(error));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  const generate = async () => {
    if (!valid || pending.current) return;
    pending.current = true;
    setBusy("generate");
    setError(null);
    try {
      const notes = await invoke<{ name: string; body: string }>("github_generate_release_notes", {
        repoPath,
        tag: input.tag_name.trim(),
        target: input.target_commitish.trim(),
        previousTag: previousTag.trim() || null,
      });
      setInput((current) => ({
        ...current,
        name: current.name || notes.name,
        body: current.body ? `${current.body}\n\n${notes.body}` : notes.body,
      }));
    } catch (error) {
      setError(String(error));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  return (
    <ResourceViewerBody>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FieldGroup>
          <div className="grid gap-4 @min-[36rem]/resource-viewer:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-tag`}>Tag</FieldLabel>
              <Input
                id={`${fieldId}-tag`}
                required
                placeholder="v1.0.0"
                disabled={Boolean(busy)}
                value={input.tag_name}
                onChange={(event) => setInput({ ...input, tag_name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-target`}>Target branch or commit</FieldLabel>
              <Input
                id={`${fieldId}-target`}
                required
                placeholder="Branch name or commit SHA"
                disabled={Boolean(busy)}
                value={input.target_commitish}
                onChange={(event) => setInput({ ...input, target_commitish: event.target.value })}
              />
              <FieldDescription>Used when the tag does not already exist.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-name`}>Release title</FieldLabel>
            <Input
              id={`${fieldId}-name`}
              placeholder="Defaults to the tag name"
              disabled={Boolean(busy)}
              value={input.name}
              onChange={(event) => setInput({ ...input, name: event.target.value })}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={`${fieldId}-prerelease`}
              checked={input.prerelease}
              disabled={Boolean(busy)}
              onCheckedChange={(checked) => setInput({ ...input, prerelease: checked })}
            />
            <FieldLabel htmlFor={`${fieldId}-prerelease`}>Mark as prerelease</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-previous`}>
              Previous tag for generated notes
            </FieldLabel>
            <Input
              id={`${fieldId}-previous`}
              placeholder="Automatic"
              disabled={Boolean(busy)}
              value={previousTag}
              onChange={(event) => setPreviousTag(event.target.value)}
            />
            <FieldDescription>
              Generated notes are appended to your current description.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="ui-text-sm text-subtle-foreground">Release notes</span>
            <Button
              type="button"
              disabled={!valid || Boolean(busy)}
              onClick={() => void generate()}
            >
              {busy === "generate" && <Spinner compact />} Generate Notes
            </Button>
          </div>
          <GitHubMarkdownEditor
            value={input.body}
            onChange={(body) => setInput((current) => ({ ...current, body }))}
            disabled={Boolean(busy)}
            placeholder="Describe what changed in this release…"
          />
        </div>
        {error && <ViewerErrorState layout="section" message={error} />}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => {
                removeDraft();
                onCancel();
              }}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" variant="accent" disabled={!valid || Boolean(busy)}>
            {busy === "save" && <Spinner compact />}
            {release ? "Save Changes" : "Save Draft"}
          </Button>
        </div>
      </form>
    </ResourceViewerBody>
  );
}
