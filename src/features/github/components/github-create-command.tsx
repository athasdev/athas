import { invoke } from "@tauri-apps/api/core";
import { CheckIcon as Check, PlusIcon as Plus, SparkleIcon as Sparkle } from "@/ui/icons";
import { useEffect, useMemo, useState } from "react";
import { getBranches } from "@/features/git/api/git-branches-api";
import { getRefDiff } from "@/features/git/api/git-diff-api";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandInput,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import Textarea from "@/ui/textarea";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import type { IssueListItem, Label, PullRequest, WorkflowListItem } from "../types/github.types";

export type GitHubCreateKind = "pull-request" | "issue" | "action";

interface GitHubCreateCommandProps {
  kind: GitHubCreateKind | null;
  repoPath: string | null;
  defaultHead?: string;
  onClose: () => void;
  onIssueCreated: (issue: IssueListItem) => void;
  onPullRequestCreated: (pullRequest: PullRequest) => void;
  onWorkflowDispatched: () => void;
}

type PickerMode = "form" | "workflow" | "labels" | "head" | "base" | "ref";

interface GeneratedGitHubDraft {
  title?: string;
  body?: string;
}

const titleByKind: Record<GitHubCreateKind, string> = {
  "pull-request": "New pull request",
  issue: "New issue",
  action: "Run workflow",
};

function parseAssignees(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function matchesQuery(query: string, values: string[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function extractJsonObject(text: string): GeneratedGitHubDraft {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;

  try {
    const parsed = JSON.parse(candidate) as GeneratedGitHubDraft;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function summarizeDiffs(diffs: Awaited<ReturnType<typeof getRefDiff>>) {
  if (!diffs?.length) return "No branch diff available.";

  return diffs
    .slice(0, 12)
    .map((diff) => {
      const changes = diff.lines
        .filter((line) => line.line_type === "added" || line.line_type === "removed")
        .slice(0, 30)
        .map((line) => `${line.line_type === "added" ? "+" : "-"}${line.content}`)
        .join("\n");
      return `File: ${diff.file_path}\n${changes || "Binary or metadata-only change."}`;
    })
    .join("\n\n");
}

export function GitHubCreateCommand({
  kind,
  repoPath,
  defaultHead,
  onClose,
  onIssueCreated,
  onPullRequestCreated,
  onWorkflowDispatched,
}: GitHubCreateCommandProps) {
  const isVisible = Boolean(kind && repoPath);

  if (!isVisible || !kind || !repoPath) {
    return (
      <Command isVisible={false} onClose={onClose} title="GitHub">
        {null}
      </Command>
    );
  }

  return (
    <GitHubCreateCommandContent
      key={`${kind}:${repoPath}:${defaultHead ?? ""}`}
      kind={kind}
      repoPath={repoPath}
      defaultHead={defaultHead}
      onClose={onClose}
      onIssueCreated={onIssueCreated}
      onPullRequestCreated={onPullRequestCreated}
      onWorkflowDispatched={onWorkflowDispatched}
    />
  );
}

interface GitHubCreateCommandContentProps extends Omit<
  GitHubCreateCommandProps,
  "kind" | "repoPath"
> {
  kind: GitHubCreateKind;
  repoPath: string;
}

function GitHubCreateCommandContent({
  kind,
  repoPath,
  defaultHead,
  onClose,
  onIssueCreated,
  onPullRequestCreated,
  onWorkflowDispatched,
}: GitHubCreateCommandContentProps) {
  const [mode, setMode] = useState<PickerMode>("form");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState(defaultHead ?? "");
  const [base, setBase] = useState("master");
  const [draft, setDraft] = useState(false);
  const [assignees, setAssignees] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [workflowRef, setWorkflowRef] = useState(defaultHead || "master");
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const subscription = useAuthStore((state) => state.subscription);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getBranches(repoPath),
      invoke<Label[]>("github_list_labels", { repoPath }).catch(() => []),
      kind === "action"
        ? invoke<WorkflowListItem[]>("github_list_workflows", { repoPath })
        : Promise.resolve([]),
    ])
      .then(([nextBranches, nextLabels, nextWorkflows]) => {
        if (cancelled) return;
        const cleanBranches = nextBranches.filter(Boolean);
        setBranches(cleanBranches);
        setLabels(nextLabels);
        const activeWorkflows = nextWorkflows.filter((workflow) => workflow.state !== "deleted");
        setWorkflows(activeWorkflows);
        setWorkflowId((current) => current || activeWorkflows[0]?.id.toString() || "");
        if (!defaultHead && cleanBranches[0]) {
          setHead(cleanBranches[0]);
          setWorkflowRef(cleanBranches[0]);
        }
        setBase((currentBase) =>
          !cleanBranches.includes(currentBase) && cleanBranches.includes("main")
            ? "main"
            : currentBase,
        );
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingMetadata(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultHead, kind, repoPath]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id.toString() === workflowId);
  const selectedLabelNames = Array.from(selectedLabels);
  const parsedAssignees = parseAssignees(assignees);
  const canSubmit =
    kind === "issue"
      ? title.trim().length > 0
      : kind === "pull-request"
        ? title.trim().length > 0 && head.trim().length > 0 && base.trim().length > 0
        : Boolean(workflowId && workflowRef.trim());

  const filteredWorkflows = useMemo(
    () =>
      workflows.filter((workflow) =>
        matchesQuery(query, [workflow.name, workflow.path, workflow.id.toString()]),
      ),
    [query, workflows],
  );
  const filteredLabels = useMemo(
    () => labels.filter((label) => matchesQuery(query, [label.name])),
    [labels, query],
  );
  const filteredBranches = useMemo(
    () => branches.filter((branch) => matchesQuery(query, [branch])),
    [branches, query],
  );

  const closePicker = () => {
    setMode("form");
    setQuery("");
  };

  const handleSubmit = async () => {
    if (!kind || !repoPath || !canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      if (kind === "issue") {
        const issue = await invoke<IssueListItem>("github_create_issue", {
          repoPath,
          title,
          body,
          labels: selectedLabelNames,
          assignees: parsedAssignees,
        });
        onIssueCreated(issue);
        toast.success("Issue created", `#${issue.number} ${issue.title}`);
        onClose();
        return;
      }

      if (kind === "pull-request") {
        const pullRequest = await invoke<PullRequest>("github_create_pull_request", {
          repoPath,
          title,
          body,
          head,
          base,
          draft,
          labels: selectedLabelNames,
          assignees: parsedAssignees,
        });
        onPullRequestCreated(pullRequest);
        toast.success("Pull request created", `#${pullRequest.number} ${pullRequest.title}`);
        onClose();
        return;
      }

      await invoke("github_dispatch_workflow", {
        repoPath,
        workflowId: Number(workflowId),
        reference: workflowRef,
      });
      onWorkflowDispatched();
      toast.success("Workflow queued");
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!kind || kind === "action" || !repoPath || isGenerating) return;

    setIsGenerating(true);
    setError(null);

    try {
      const enterprisePolicy = subscription?.enterprise?.policy;
      const isPro = hasProductCapability(subscription, "hostedAi");
      if (enterprisePolicy?.managedMode && enterprisePolicy.aiCompletionEnabled === false) {
        setError("AI generation is disabled by your organization policy.");
        return;
      }

      const useByok = enterprisePolicy ? enterprisePolicy.allowByok && !isPro : !isPro;
      const status = await getGitStatus(repoPath);
      const diffSummary =
        kind === "pull-request" ? summarizeDiffs(await getRefDiff(repoPath, base, head)) : "";
      const statusSummary =
        status?.files
          .slice(0, 30)
          .map((file) => `${file.status}${file.staged ? " staged" : ""}: ${file.path}`)
          .join("\n") || "No working tree status available.";
      const selectedLabelSummary = selectedLabelNames.length
        ? selectedLabelNames.join(", ")
        : "No labels selected.";

      const prompt =
        kind === "pull-request"
          ? `Create a concise GitHub pull request title and body from this repository context.
Return only JSON with "title" and "body" string fields.
Title must be short and imperative. Body should include a compact summary and test notes if inferable.

Repository: ${repoPath}
Branch: ${head} -> ${base}
Labels: ${selectedLabelSummary}
Existing title: ${title || "(empty)"}
Existing body: ${body || "(empty)"}

Git status:
${statusSummary}

Diff summary:
${diffSummary}`
          : `Create a concise GitHub issue title and body from this draft.
Return only JSON with "title" and "body" string fields.
Title must be specific. Body should include problem, expected behavior, and useful context without filler.

Repository: ${repoPath}
Labels: ${selectedLabelSummary}
Assignees: ${parsedAssignees.join(", ") || "None"}
Existing title: ${title || "(empty)"}
Existing body: ${body || "(empty)"}

Git status:
${statusSummary}`;

      const { editedText } = await requestInlineEdit(
        {
          model: aiAutocompleteModelId,
          beforeSelection: "",
          selectedText: prompt,
          afterSelection: "",
          instruction:
            "Generate a GitHub issue or pull request draft. Return valid JSON only with title and body string fields. Do not include markdown fences or explanation.",
          filePath: kind === "pull-request" ? "github-pull-request" : "github-issue",
          languageId: "json",
        },
        { useByok },
      );

      const draft = extractJsonObject(editedText);
      if (!draft.title?.trim() && !draft.body?.trim()) {
        throw new Error("AI did not return a usable draft.");
      }
      if (draft.title?.trim()) setTitle(draft.title.trim());
      if (draft.body?.trim()) setBody(draft.body.trim());
      toast.success(kind === "pull-request" ? "PR draft generated" : "Issue draft generated");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Command isVisible onClose={onClose} title={titleByKind[kind]} className="max-h-[540px]">
      <CommandHeader onClose={mode === "form" ? onClose : closePicker}>
        {mode === "form" ? (
          <span className="min-w-0 flex-1 truncate font-sans ui-text-base text-text">
            {titleByKind[kind]}
          </span>
        ) : (
          <CommandInput
            value={query}
            onChange={setQuery}
            placeholder={
              mode === "workflow"
                ? "Search workflows"
                : mode === "labels"
                  ? "Search labels"
                  : "Search branches"
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePicker();
              }
            }}
          />
        )}
      </CommandHeader>

      {mode === "workflow" ? (
        <CommandList>
          {filteredWorkflows.length === 0 ? (
            <CommandEmpty>
              {isLoadingMetadata ? "Loading workflows..." : "No workflows found."}
            </CommandEmpty>
          ) : (
            filteredWorkflows.map((workflow) => {
              const selected = workflow.id.toString() === workflowId;
              return (
                <CommandItemRow
                  key={workflow.id}
                  isSelected={selected}
                  onClick={() => {
                    setWorkflowId(workflow.id.toString());
                    closePicker();
                  }}
                  title={workflow.name || workflow.path}
                  accessory={selected ? <Check className="size-3.5 text-accent" /> : null}
                />
              );
            })
          )}
        </CommandList>
      ) : mode === "labels" ? (
        <CommandList>
          {filteredLabels.length === 0 ? (
            <CommandEmpty>
              {isLoadingMetadata ? "Loading labels..." : "No labels found."}
            </CommandEmpty>
          ) : (
            filteredLabels.map((label) => {
              const selected = selectedLabels.has(label.name);
              return (
                <CommandItemRow
                  key={label.name}
                  isSelected={selected}
                  onClick={() => {
                    setSelectedLabels((current) => {
                      const next = new Set(current);
                      if (next.has(label.name)) {
                        next.delete(label.name);
                      } else {
                        next.add(label.name);
                      }
                      return next;
                    });
                  }}
                  icon={
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: label.color ? `#${label.color}` : undefined }}
                    />
                  }
                  title={label.name}
                  accessory={selected ? <Check className="size-3.5 text-accent" /> : null}
                />
              );
            })
          )}
        </CommandList>
      ) : mode === "head" || mode === "base" || mode === "ref" ? (
        <CommandList>
          {filteredBranches.length === 0 ? (
            <CommandEmpty>
              {isLoadingMetadata ? "Loading branches..." : "No branches found."}
            </CommandEmpty>
          ) : (
            filteredBranches.map((branch) => {
              const selected =
                mode === "head"
                  ? branch === head
                  : mode === "base"
                    ? branch === base
                    : branch === workflowRef;
              return (
                <CommandItemRow
                  key={branch}
                  isSelected={selected}
                  onClick={() => {
                    if (mode === "head") setHead(branch);
                    if (mode === "base") setBase(branch);
                    if (mode === "ref") setWorkflowRef(branch);
                    closePicker();
                  }}
                  title={branch}
                  accessory={selected ? <Check className="size-3.5 text-accent" /> : null}
                />
              );
            })
          )}
        </CommandList>
      ) : (
        <CommandList>
          <div className="space-y-2 p-2">
            {kind === "action" ? (
              <>
                <FieldButton
                  label="Workflow"
                  value={selectedWorkflow?.name || "Select workflow"}
                  onClick={() => setMode("workflow")}
                />
                <FieldButton
                  label="Ref"
                  value={workflowRef || "Select ref"}
                  onClick={() => setMode("ref")}
                />
              </>
            ) : (
              <>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canSubmit) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={kind === "issue" ? "Issue title" : "Pull request title"}
                  size="md"
                />
                {kind === "pull-request" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <FieldButton
                      label="Head"
                      value={head || "Select"}
                      onClick={() => setMode("head")}
                    />
                    <FieldButton
                      label="Base"
                      value={base || "Select"}
                      onClick={() => setMode("base")}
                    />
                  </div>
                ) : null}
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Description"
                  size="md"
                  className="min-h-24 resize-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <FieldButton
                    label="Labels"
                    value={selectedLabelNames.length > 0 ? selectedLabelNames.join(", ") : "None"}
                    onClick={() => setMode("labels")}
                  />
                  <Input
                    value={assignees}
                    onChange={(event) => setAssignees(event.target.value)}
                    placeholder="Assignees"
                    size="md"
                  />
                </div>
                {kind === "pull-request" ? (
                  <label className="flex items-center gap-2 px-1 font-sans ui-text-base text-text-lighter">
                    <Checkbox
                      checked={draft}
                      onChange={setDraft}
                      ariaLabel="Create as draft pull request"
                    />
                    Draft
                  </label>
                ) : null}
              </>
            )}
            {error ? <div className="ui-text-base text-error">{error}</div> : null}
          </div>
        </CommandList>
      )}

      <CommandFooter>
        {mode === "labels" ? (
          <CommandFooterAction type="button" onClick={closePicker}>
            Done
          </CommandFooterAction>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate px-1 ui-text-base text-text-lighter">
              {mode === "form" ? repoPath : titleByKind[kind]}
            </span>
            {kind !== "action" ? (
              <CommandFooterAction
                type="button"
                disabled={mode !== "form" || isGenerating || isSubmitting}
                onClick={handleGenerateDraft}
              >
                {isGenerating ? <Spinner label="Generating" compact /> : <Sparkle />}
                Generate
              </CommandFooterAction>
            ) : null}
            <CommandFooterAction
              type="button"
              disabled={mode !== "form" || !canSubmit || isSubmitting}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <Spinner label={kind === "action" ? "Running" : "Creating"} compact />
              ) : (
                <Plus />
              )}
              {kind === "action" ? "Run" : "Create"}
            </CommandFooterAction>
          </>
        )}
      </CommandFooter>
    </Command>
  );
}

function FieldButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="default"
      size="xs"
      onClick={onClick}
      className={cn(
        "h-8 min-w-0 justify-start gap-2 bg-secondary-bg px-2 text-left hover:bg-hover",
      )}
    >
      <span className="shrink-0 font-sans ui-text-base text-text-lighter">{label}</span>
      <span className="min-w-0 flex-1 truncate font-sans ui-text-base text-text">{value}</span>
    </Button>
  );
}
