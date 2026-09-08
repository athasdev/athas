import { groupByDate } from "../../utils/github-sidebar-groups";
import type {
  DeliveryKind,
  DeliveryResource,
  Deployment,
  DeploymentFilter,
  Release,
  ReleaseFilter,
} from "../types/github-delivery.types";

export const RELEASE_FILTERS: Record<ReleaseFilter, string> = {
  all: "All Releases",
  published: "Stable",
  draft: "Drafts",
  prerelease: "Prereleases",
};
export const DEPLOYMENT_FILTERS: Record<DeploymentFilter, string> = {
  all: "All Deployments",
  active: "Successful",
  pending: "In Progress",
  failed: "Failed",
  inactive: "Inactive",
};

export function isRelease(item: DeliveryResource): item is Release {
  return "tag_name" in item;
}

export function releaseTitle(release: Release): string {
  return release.name?.trim() || release.tag_name;
}

export function deploymentState(deployment: Deployment) {
  if (deployment.status_error)
    return { label: "Status unavailable", tone: "warning" as const, pending: false };
  return deploymentStatusState(deployment.statuses[0]?.state);
}

export function deploymentStatusState(state?: string) {
  switch (state) {
    case "success":
      return { label: "Successful", tone: "success" as const, pending: false };
    case "failure":
      return { label: "Failed", tone: "error" as const, pending: false };
    case "error":
      return { label: "Error", tone: "error" as const, pending: false };
    case "inactive":
      return { label: "Inactive", tone: "muted" as const, pending: false };
    case "queued":
      return { label: "Queued", tone: "warning" as const, pending: true };
    case "pending":
      return { label: "Pending", tone: "warning" as const, pending: true };
    case "in_progress":
      return { label: "In progress", tone: "accent" as const, pending: true };
    default:
      return {
        label: state ? "Unknown status" : "Awaiting status",
        tone: "muted" as const,
        pending: true,
      };
  }
}

export function matchesDelivery(item: DeliveryResource, filter: string, query: string): boolean {
  const search = query.trim().toLowerCase();
  if (isRelease(item)) {
    const matchesFilter =
      filter === "all" ||
      (filter === "draft" && item.draft) ||
      (filter === "prerelease" && !item.draft && item.prerelease) ||
      (filter === "published" && !item.draft && !item.prerelease);
    return (
      matchesFilter &&
      [
        item.name,
        item.tag_name,
        item.target_commitish,
        item.author?.login,
        ...item.assets.map((asset) => asset.name),
      ].some((value) => value?.toLowerCase().includes(search))
    );
  }
  const state = item.statuses[0]?.state;
  const matchesFilter =
    filter === "all" ||
    (!item.status_error &&
      ((filter === "active" && state === "success") ||
        (filter === "pending" && deploymentState(item).pending) ||
        (filter === "failed" && (state === "failure" || state === "error")) ||
        (filter === "inactive" && state === "inactive")));
  return (
    matchesFilter &&
    [
      item.environment,
      item.ref,
      item.sha,
      item.description,
      item.creator?.login,
      String(item.id),
    ].some((value) => value?.toLowerCase().includes(search))
  );
}

export function groupDelivery(items: DeliveryResource[]) {
  return groupByDate(items, (item) =>
    isRelease(item) ? (item.published_at ?? item.created_at) : item.created_at,
  );
}

export function deliveryKey(kind: DeliveryKind, repoPath: string, id: number | "new") {
  return JSON.stringify([kind, repoPath, id]);
}

export function deliveryBufferPath(kind: DeliveryKind, repoPath: string, id: number | "new") {
  return `github-${kind}://${encodeURIComponent(repoPath)}/${id}`;
}

export function safeDeliveryUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function formatAssetSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
