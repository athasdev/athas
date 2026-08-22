import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  adminDataTableToCsv,
  jsonToAdminDataTable,
} from "@/features/admin-data/lib/admin-data-model";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";

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

export async function loadAdminDataSource(source: AdminDataSource): Promise<string> {
  const url = validateSourceUrl(source.url);
  const headers: Record<string, string> = { Accept: "application/json" };

  if (source.authentication === "github") {
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
  return adminDataTableToCsv(jsonToAdminDataTable(payload, source.rowsPath));
}
