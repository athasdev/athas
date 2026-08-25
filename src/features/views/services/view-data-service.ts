import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { viewTableToCsv, jsonToViewTable } from "@/features/views/lib/view-model";
import {
  buildProjectGitHubApiUrl,
  resolveProjectGitHubRepository,
} from "@/features/views/lib/view-github";
import type { CustomViewDefinition, ViewTable } from "@/features/views/types/view.types";

function validateSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid source URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Source URL must use HTTP or HTTPS");
  }

  return url;
}

export async function loadViewTable(
  view: CustomViewDefinition,
  projectPath?: string,
): Promise<ViewTable> {
  let sourceUrl: string;
  if (view.kind === "github") {
    if (!projectPath) throw new Error("Open a project before loading this GitHub source");
    const repository = await resolveProjectGitHubRepository(projectPath);
    if (!repository) throw new Error("This project does not have a GitHub remote");
    sourceUrl = buildProjectGitHubApiUrl(repository, view.endpointPath);
  } else {
    sourceUrl = view.url;
  }

  const url = validateSourceUrl(sourceUrl);
  const headers: Record<string, string> = { Accept: "application/json" };

  if (view.kind === "github" || view.authentication === "github") {
    if (url.hostname !== "api.github.com") {
      throw new Error("GitHub authentication can only be used with api.github.com");
    }

    const token = await invoke<string | null>("get_github_token");
    if (!token) throw new Error("Connect a GitHub account before using GitHub authentication");

    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const response = await tauriFetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`Source request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  return jsonToViewTable(payload, view.rowsPath);
}

export async function loadViewData(
  view: CustomViewDefinition,
  projectPath?: string,
): Promise<string> {
  return viewTableToCsv(await loadViewTable(view, projectPath));
}
