import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import type { GitHubRepository } from "@/features/views/lib/view-github";
import type { CustomViewDefinition } from "@/features/views/types/view.types";

type GeneratedViewPlan = Omit<Extract<CustomViewDefinition, { kind: "github" }>, "id">;

function createView(plan: GeneratedViewPlan): CustomViewDefinition {
  return { id: crypto.randomUUID(), ...plan };
}

function parsePresentation(value: unknown): CustomViewDefinition["presentation"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const presentation = value as Record<string, unknown>;
  if (
    presentation.layout !== "table" &&
    presentation.layout !== "list" &&
    presentation.layout !== "board"
  ) {
    return undefined;
  }

  return {
    layout: presentation.layout,
    ...(presentation.groupBy === null
      ? { groupBy: null }
      : typeof presentation.groupBy === "string"
        ? { groupBy: presentation.groupBy.trim() }
        : {}),
    ...(typeof presentation.titleColumn === "string"
      ? { titleColumn: presentation.titleColumn.trim() }
      : {}),
    ...(typeof presentation.descriptionColumn === "string"
      ? { descriptionColumn: presentation.descriptionColumn.trim() }
      : {}),
  };
}

export function createKnownGitHubView(request: string): CustomViewDefinition | null {
  const normalized = request.toLocaleLowerCase();
  const mentionsReleases = /release|releases|sürüm|yayın/.test(normalized);
  const mentionsDownloads = /download|downloads|indirme|asset|artifact/.test(normalized);

  if (mentionsReleases && mentionsDownloads) {
    return createView({
      kind: "github",
      name: "Release downloads",
      endpointPath: "/releases?per_page=100",
      rowsPath: "assets[]",
    });
  }

  if (mentionsReleases) {
    return createView({
      kind: "github",
      name: "Releases",
      endpointPath: "/releases?per_page=100",
      rowsPath: "",
      presentation: { layout: "list", titleColumn: "tag_name", descriptionColumn: "name" },
    });
  }

  if (/workflow|action|actions|ci run|build/.test(normalized)) {
    return createView({
      kind: "github",
      name: "Workflow runs",
      endpointPath: "/actions/runs?per_page=100",
      rowsPath: "workflow_runs",
      presentation: { layout: "board", groupBy: "status", titleColumn: "name" },
    });
  }

  if (/pull request|pull requests|\bpr\b/.test(normalized)) {
    return createView({
      kind: "github",
      name: "Pull requests",
      endpointPath: "/pulls?state=all&per_page=100",
      rowsPath: "",
      presentation: { layout: "board", groupBy: "state", titleColumn: "title" },
    });
  }

  if (/issue|issues|ticket/.test(normalized)) {
    return createView({
      kind: "github",
      name: "Issues",
      endpointPath: "/issues?state=all&per_page=100",
      rowsPath: "",
      presentation: { layout: "list", groupBy: "state", titleColumn: "title" },
    });
  }

  return null;
}

export function parseGeneratedViewPlan(value: string): CustomViewDefinition {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Athas Intelligence did not return a custom view");

  const parsed = JSON.parse(value.slice(start, end + 1)) as Record<string, unknown>;
  if (parsed.kind === "manual") {
    throw new Error(
      typeof parsed.reason === "string" ? parsed.reason : "This view needs manual configuration",
    );
  }

  if (
    parsed.kind !== "github" ||
    typeof parsed.name !== "string" ||
    typeof parsed.endpointPath !== "string" ||
    typeof parsed.rowsPath !== "string"
  ) {
    throw new Error("Athas Intelligence returned an unsupported custom view");
  }

  const name = parsed.name.trim();
  const endpointPath = parsed.endpointPath.trim();
  if (!name || !endpointPath.startsWith("/") || endpointPath.startsWith("//")) {
    throw new Error("Athas Intelligence returned an invalid GitHub view");
  }
  const presentation = parsePresentation(parsed.presentation);

  return createView({
    kind: "github",
    name,
    endpointPath,
    rowsPath: parsed.rowsPath.trim(),
    ...(presentation ? { presentation } : {}),
  });
}

export async function generateCustomView(options: {
  request: string;
  repository: GitHubRepository;
  model: string;
}): Promise<CustomViewDefinition> {
  const { request, repository, model } = options;
  const { editedText } = await requestInlineEdit(
    {
      model,
      beforeSelection: "",
      selectedText: `Project GitHub repository: ${repository.owner}/${repository.repo}\nUser request: ${request}`,
      afterSelection: "",
      instruction: `Generate a read-only custom view for the current project's GitHub repository.
Return only one JSON object with these fields:
{"kind":"github","name":"Short view name","endpointPath":"/repository-relative GitHub REST API path","rowsPath":"optional dot path with [] for arrays","presentation":{"layout":"table","groupBy":"optional column","titleColumn":"optional column","descriptionColumn":"optional column"}}

Set presentation.layout to table, list, or board. Prefer board for status-driven work, list for content with a clear title, and table for numeric or highly structured data. Only use column names returned by the endpoint.

The endpoint path is always relative to /repos/${repository.owner}/${repository.repo}. Never return a host, full URL, token, GraphQL request, mutation, or endpoint for another repository. Use per_page=100 for list endpoints. For release download statistics use /releases?per_page=100 with rowsPath assets[]. For workflow runs use /actions/runs?per_page=100 with rowsPath workflow_runs.

If the request cannot be represented by a read-only GitHub REST endpoint, return {"kind":"manual","reason":"Brief reason"}.`,
      filePath: `${repository.owner}/${repository.repo}`,
      languageId: "json",
    },
    { useHosted: true },
  );

  return parseGeneratedViewPlan(editedText);
}
