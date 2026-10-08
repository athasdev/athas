import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings/commands";
import type {
  Deployment as BindingDeployment,
  Release as BindingRelease,
} from "@/bindings/commands";
import type {
  DeliveryKind,
  DeliveryResource,
  Deployment,
  Release,
} from "../types/github-delivery.types";

const DELIVERY_DETAIL_STALE_MS = 30_000;
const DELIVERY_LIST_STALE_MS = 60_000;
export const DELIVERY_PAGE_SIZE = 20;

export const deliveryKeys = {
  list: (kind: DeliveryKind, repoPath: string) => ["github", repoPath, kind, "list"] as const,
  item: (kind: DeliveryKind, repoPath: string, id: number) =>
    ["github", repoPath, kind, "item", id] as const,
};

export function normalizeRelease(release: BindingRelease): Release {
  return { ...release, immutable: release.immutable ?? false };
}

function normalizeDeployment(deployment: BindingDeployment): Deployment {
  return {
    ...deployment,
    transient_environment: deployment.transient_environment ?? false,
    production_environment: deployment.production_environment ?? false,
    statuses: deployment.statuses ?? [],
    status_error: deployment.status_error ?? null,
  };
}

export function fetchDeliveryPage(
  kind: DeliveryKind,
  repoPath: string,
  page: number,
): Promise<DeliveryResource[]> {
  return kind === "releases"
    ? commands.githubListReleases(repoPath, page).then((items) => items.map(normalizeRelease))
    : commands
        .githubListDeployments(repoPath, page)
        .then((items) => items.map(normalizeDeployment));
}

export function deliveryListQuery(kind: DeliveryKind, repoPath: string) {
  return infiniteQueryOptions({
    queryKey: deliveryKeys.list(kind, repoPath),
    queryFn: ({ pageParam }) => fetchDeliveryPage(kind, repoPath, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.length === DELIVERY_PAGE_SIZE ? lastPageParam + 1 : undefined,
    staleTime: DELIVERY_LIST_STALE_MS,
    // Polling refetches every loaded page, so only the first page is kept current on its own.
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 1 ? DELIVERY_LIST_STALE_MS : false,
  });
}

export function deliveryDetailQuery(kind: DeliveryKind, repoPath: string, id: number | undefined) {
  return queryOptions({
    queryKey: deliveryKeys.item(kind, repoPath, id ?? -1),
    queryFn: async (): Promise<DeliveryResource> => {
      if (id === undefined) throw new Error("No release or deployment selected.");
      return kind === "releases"
        ? normalizeRelease(await commands.githubGetRelease(repoPath, id))
        : normalizeDeployment(await commands.githubGetDeployment(repoPath, id));
    },
    enabled: id !== undefined,
    staleTime: DELIVERY_DETAIL_STALE_MS,
  });
}

/** A release or deployment changed: refresh its detail and the list it appears in. */
export function notifyDeliveryChanged(
  client: QueryClient,
  kind: DeliveryKind,
  repoPath: string,
  id: number,
) {
  void client.invalidateQueries({ queryKey: deliveryKeys.list(kind, repoPath) });
  void client.invalidateQueries({ queryKey: deliveryKeys.item(kind, repoPath, id) });
}
