import { commands } from "@/bindings/commands";
import type {
  Deployment as BindingDeployment,
  Release as BindingRelease,
} from "@/bindings/commands";
import { createTimedResourceCache } from "@/utils/timed-resource-cache";
import type {
  DeliveryKind,
  DeliveryResource,
  Deployment,
  Release,
} from "../types/github-delivery.types";
import { deliveryKey } from "../utils/github-delivery";

export const DELIVERY_CHANGED = "athas:github-delivery-changed";
export const DELIVERY_TTL = 30_000;
export const DELIVERY_LIST_TTL = 60_000;
export const DELIVERY_PAGE_SIZE = 20;
export const deliveryListCache = createTimedResourceCache<DeliveryResource[]>();
export const deliveryDetailCache = createTimedResourceCache<DeliveryResource>();

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

export function loadDeliveryPage(
  kind: DeliveryKind,
  repoPath: string,
  page: number,
  force = false,
) {
  return deliveryListCache.load(
    deliveryKey(kind, repoPath, page),
    (): Promise<DeliveryResource[]> =>
      kind === "releases"
        ? commands.githubListReleases(repoPath, page).then((items) => items.map(normalizeRelease))
        : commands
            .githubListDeployments(repoPath, page)
            .then((items) => items.map(normalizeDeployment)),
    { ttlMs: DELIVERY_LIST_TTL, force },
  );
}

export function loadDeliveryDetail(
  kind: DeliveryKind,
  repoPath: string,
  id: number,
  force = false,
) {
  return deliveryDetailCache.load(
    deliveryKey(kind, repoPath, id),
    (): Promise<DeliveryResource> =>
      kind === "releases"
        ? commands.githubGetRelease(repoPath, id).then(normalizeRelease)
        : commands.githubGetDeployment(repoPath, id).then(normalizeDeployment),
    { ttlMs: DELIVERY_TTL, force },
  );
}

export function notifyDeliveryChanged(kind: DeliveryKind, repoPath: string, id: number) {
  deliveryListCache.clear();
  deliveryDetailCache.clear(deliveryKey(kind, repoPath, id));
  window.dispatchEvent(new CustomEvent(DELIVERY_CHANGED, { detail: { kind, repoPath, id } }));
}
