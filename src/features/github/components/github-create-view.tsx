import { invoke } from "@tauri-apps/api/core";
import {
  ChatCircleTextIcon as Issue,
  GitBranchIcon as GitBranch,
  GitPullRequestIcon as GitPullRequest,
  PlusIcon as Plus,
  PulseIcon as Activity,
  SparkleIcon as Sparkle,
} from "@/ui/icons";
import { useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { GitHubFormContent } from "@/features/panes/types/pane-content.types";
import { getBranches } from "@/features/git/api/git-branches-api";
import { getRefDiff } from "@/features/git/api/git-diff-api";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import type {
  IssueListItem,
  IssueMilestone,
  IssueType,
  Label,
  PullRequest,
  WorkflowListItem,
} from "../types/github.types";
import { useGitHubStore } from "../stores/github.store";
import { githubActionListCache, githubIssueListCache } from "../utils/github-data-cache";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { getRepositoryDisplayName } from "../utils/github-viewer-utils";
import { GitHubMarkdownEditor } from "./github-markdown-editor";
import { GitHubAssigneePicker, GitHubLabelPicker } from "./github-metadata-pickers";
import { GitHubViewerHeader, GitHubViewerShell } from "./github-viewer-shell";

export type GitHubCreateKind = "pull-request" | "issue" | "action";

interface GeneratedGitHubDraft {
  title?: string;
  body?: string;
}

const titleByKind: Record<GitHubCreateKind, string> = {
  "pull-request": "New pull request",
  issue: "New issue",
  action: "Run workflow",
};

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

export function GitHubCreateView({ buffer }: { buffer: GitHubFormContent }) {
  const closeBuffer = useBufferStore.use.actions().closeBufferForce;
  const openIssue = useBufferStore.use.actions().openGitHubIssueBuffer;
  const openPullRequest = useBufferStore.use.actions().openPRBuffer;
  const fetchPRs = useGitHubStore((state) => state.actions.fetchPRs);
  const close = () => closeBuffer(buffer.id);

  return (
    <GitHubCreateViewContent
      key={buffer.path}
      kind={buffer.formKind}
      repoPath={buffer.repoPath}
      defaultHead={buffer.defaultHead}
      onClose={close}
      onIssueCreated={(issue) => {
        githubIssueListCache.clear();
        close();
        openIssue({
          issueNumber: issue.number,
          repoPath: buffer.repoPath,
          title: issue.title,
          authorAvatarUrl: getGitHubAvatarUrl(issue.author),
          url: issue.url,
        });
      }}
      onPullRequestCreated={(pullRequest) => {
        void fetchPRs(buffer.repoPath, { force: true });
        close();
        openPullRequest(pullRequest.number, {
          title: pullRequest.title,
          repoPath: buffer.repoPath,
          authorAvatarUrl: getGitHubAvatarUrl(pullRequest.author),
        });
      }}
      onWorkflowDispatched={() => {
        githubActionListCache.clear(buffer.repoPath);
        close();
      }}
    />
  );
}

interface GitHubCreateViewContentProps {
  kind: GitHubCreateKind;
  repoPath: string;
  defaultHead?: string;
  onClose: () => void;
  onIssueCreated: (issue: IssueListItem) => void;
  onPullRequestCreated: (pullRequest: PullRequest) => void;
  onWorkflowDispatched: () => void;
}

function GitHubCreateViewContent({
  kind,
  repoPath,
  defaultHead,
  onClose,
  onIssueCreated,
  onPullRequestCreated,
  onWorkflowDispatched,
}: GitHubCreateViewContentProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState(defaultHead ?? "");
  const [base, setBase] = useState("master");
  const [draft, setDraft] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [milestones, setMilestones] = useState<IssueMilestone[]>([]);
  const [issueTypes, setIssueTypes] = useState<IssueType[]>([]);
  const [milestone, setMilestone] = useState("none");
  const [issueType, setIssueType] = useState("none");
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
      kind === "issue"
        ? invoke<IssueMilestone[]>("github_list_milestones", { repoPath }).catch(() => [])
        : Promise.resolve([]),
      kind === "issue"
        ? invoke<IssueType[]>("github_list_issue_types", { repoPath }).catch(() => [])
        : Promise.resolve([]),
      kind === "action"
        ? invoke<WorkflowListItem[]>("github_list_workflows", { repoPath })
        : Promise.resolve([]),
    ])
      .then(([nextBranches, nextLabels, nextMilestones, nextIssueTypes, nextWorkflows]) => {
        if (cancelled) return;
        const cleanBranches = nextBranches.filter(Boolean);
        setBranches(cleanBranches);
        setLabels(nextLabels);
        setMilestones(nextMilestones);
        setIssueTypes(nextIssueTypes);
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

  const repositoryName = getRepositoryDisplayName(repoPath);
  const selectedLabelNames = Array.from(selectedLabels);
  const canSubmit =
    kind === "issue"
      ? title.trim().length > 0
      : kind === "pull-request"
        ? title.trim().length > 0 && head.trim().length > 0 && base.trim().length > 0
        : Boolean(workflowId && workflowRef.trim());

  const branchOptions = useMemo(
    () => branches.map((branch) => ({ value: branch, label: branch })),
    [branches],
  );
  const workflowOptions = useMemo(
    () =>
      workflows.map((workflow) => ({
        value: workflow.id.toString(),
        label: workflow.name || workflow.path,
        keywords: [workflow.path],
      })),
    [workflows],
  );

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
          assignees,
          milestone: milestone === "none" ? null : Number(milestone),
          issueType: issueType === "none" ? null : issueType,
        });
        onIssueCreated(issue);
        toast.success("Issue created", { description: `#${issue.number} ${issue.title}` });
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
          assignees,
        });
        onPullRequestCreated(pullRequest);
        toast.success("Pull request created", {
          description: `#${pullRequest.number} ${pullRequest.title}`,
        });
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
Assignees: ${assignees.join(", ") || "None"}
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
    <GitHubViewerShell
      header={
        <GitHubViewerHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              {kind === "pull-request" ? (
                <GitPullRequest className="text-primary" />
              ) : kind === "issue" ? (
                <Issue className="text-primary" />
              ) : (
                <Activity className="text-primary" />
              )}
              <span>{titleByKind[kind]}</span>
              <span className="truncate font-normal text-subtle-foreground">
                in {repositoryName}
              </span>
            </span>
          }
          actions={
            <Button type="button" variant="ghost" size="xs" onClick={onClose}>
              Cancel
            </Button>
          }
        />
      }
    >
      <div className="mx-auto w-full max-w-4xl pt-7 pb-16">
        {kind === "action" ? (
          <div>
            <div className="space-y-2 pb-6">
              <div className="flex items-center gap-2 font-sans ui-text-sm text-subtle-foreground">
                <Activity />
                <span>{repositoryName}</span>
              </div>
              <h1 className="font-sans text-2xl leading-tight font-semibold tracking-tight text-foreground">
                Run workflow
              </h1>
              <p className="font-sans ui-text-sm text-subtle-foreground">
                Choose a workflow and the branch or tag it should run against.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-border/60 border-y py-3">
              <div className="flex min-w-56 flex-1 items-center gap-2">
                <span className="shrink-0 font-sans ui-text-sm text-subtle-foreground">
                  Workflow
                </span>
                <Select
                  value={workflowId}
                  options={workflowOptions}
                  onChange={setWorkflowId}
                  placeholder={isLoadingMetadata ? "Loading..." : "Choose workflow"}
                  searchable
                  size="sm"
                  className="min-w-0 flex-1"
                  triggerClassName="justify-start bg-transparent"
                  menuMinWidth={280}
                  aria-label="Choose workflow"
                />
              </div>
              <div className="flex min-w-56 flex-1 items-center gap-2">
                <span className="shrink-0 font-sans ui-text-sm text-subtle-foreground">Ref</span>
                <Select
                  value={workflowRef}
                  options={branchOptions}
                  onChange={setWorkflowRef}
                  placeholder={isLoadingMetadata ? "Loading..." : "Choose branch or tag"}
                  searchable
                  allowCustomValue
                  size="sm"
                  className="min-w-0 flex-1"
                  triggerClassName="justify-start bg-transparent"
                  menuMinWidth={240}
                  aria-label="Choose workflow ref"
                />
              </div>
            </div>

            {error ? (
              <div className="mt-3 rounded-lg bg-destructive/6 px-3 py-2 ui-text-sm text-destructive">
                {error}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="accent"
                size="sm"
                disabled={!canSubmit || isSubmitting}
                onClick={() => void handleSubmit()}
              >
                {isSubmitting ? <Spinner label="Running" compact /> : <Plus />}
                Run workflow
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="pb-5">
              <div className="mb-2 flex items-center gap-2 font-sans ui-text-sm text-subtle-foreground">
                {kind === "pull-request" ? <GitPullRequest /> : <Issue />}
                <span>{repositoryName}</span>
              </div>
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
                variant="ghost"
                size="md"
                className="github-composer-title h-auto px-0 py-1 font-semibold tracking-tight"
                autoFocus
              />
            </div>

            {kind === "pull-request" ? (
              <div className="flex flex-wrap items-center gap-2 border-border/60 border-y py-3">
                <GitBranch className="text-subtle-foreground" />
                <span className="font-sans ui-text-sm text-subtle-foreground">Head</span>
                <Select
                  value={head}
                  options={branchOptions}
                  onChange={setHead}
                  placeholder={isLoadingMetadata ? "Loading..." : "Choose head"}
                  searchable
                  allowCustomValue
                  size="xs"
                  className="w-52"
                  triggerClassName="justify-start bg-transparent"
                  menuMinWidth={240}
                  aria-label="Choose head branch"
                />
                <span className="font-sans ui-text-sm text-subtle-foreground">&rarr;</span>
                <span className="font-sans ui-text-sm text-subtle-foreground">Base</span>
                <Select
                  value={base}
                  options={branchOptions}
                  onChange={setBase}
                  placeholder={isLoadingMetadata ? "Loading..." : "Choose base"}
                  searchable
                  allowCustomValue
                  size="xs"
                  className="w-52"
                  triggerClassName="justify-start bg-transparent"
                  menuMinWidth={240}
                  aria-label="Choose base branch"
                />
                <label className="ml-auto flex h-7 items-center gap-2 rounded-lg px-2 font-sans ui-text-sm text-subtle-foreground hover:bg-accent/60">
                  <Checkbox
                    checked={draft}
                    onCheckedChange={setDraft}
                    aria-label="Create as draft pull request"
                  />
                  Draft
                </label>
              </div>
            ) : null}

            <div className="pt-3">
              <GitHubMarkdownEditor
                value={body}
                onChange={setBody}
                placeholder="Write a description..."
                minHeight={240}
              />
            </div>

            {error ? (
              <div className="mt-3 rounded-lg bg-destructive/6 px-3 py-2 ui-text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-t pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <GitHubLabelPicker
                  labels={labels}
                  selectedNames={selectedLabels}
                  onChange={setSelectedLabels}
                  isLoading={isLoadingMetadata}
                />
                <GitHubAssigneePicker value={assignees} onChange={setAssignees} />
                {kind === "issue" && milestones.length > 0 ? (
                  <Select
                    value={milestone}
                    options={[
                      { value: "none", label: "No milestone" },
                      ...milestones.map((item) => ({
                        value: item.number.toString(),
                        label: item.title,
                      })),
                    ]}
                    onChange={setMilestone}
                    placeholder="Milestone"
                    size="xs"
                    className="w-40"
                    searchable
                    aria-label="Issue milestone"
                  />
                ) : null}
                {kind === "issue" && issueTypes.length > 0 ? (
                  <Select
                    value={issueType}
                    options={[
                      { value: "none", label: "No type" },
                      ...issueTypes.map((item) => ({ value: item.name, label: item.name })),
                    ]}
                    onChange={setIssueType}
                    placeholder="Issue type"
                    size="xs"
                    className="w-40"
                    searchable
                    aria-label="Issue type"
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isGenerating || isSubmitting}
                  onClick={() => void handleGenerateDraft()}
                >
                  {isGenerating ? <Spinner label="Generating" compact /> : <Sparkle />}
                  Generate
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="xs"
                  disabled={!canSubmit || isSubmitting}
                  onClick={() => void handleSubmit()}
                >
                  {isSubmitting ? <Spinner label="Creating" compact /> : <Plus />}
                  Create
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </GitHubViewerShell>
  );
}
