import { invoke } from "@tauri-apps/api/core";
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

export function loadDeliveryPage(
  kind: DeliveryKind,
  repoPath: string,
  page: number,
  force = false,
) {
  return deliveryListCache.load(
    deliveryKey(kind, repoPath, page),
    () =>
      invoke<DeliveryResource[]>(
        kind === "releases" ? "github_list_releases" : "github_list_deployments",
        { repoPath, page },
      ),
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
    () =>
      invoke<Release | Deployment>(
        kind === "releases" ? "github_get_release" : "github_get_deployment",
        { repoPath, id },
      ),
    { ttlMs: DELIVERY_TTL, force },
  );
}

export function notifyDeliveryChanged(kind: DeliveryKind, repoPath: string, id: number) {
  deliveryListCache.clear();
  deliveryDetailCache.clear(deliveryKey(kind, repoPath, id));
  window.dispatchEvent(new CustomEvent(DELIVERY_CHANGED, { detail: { kind, repoPath, id } }));
}
