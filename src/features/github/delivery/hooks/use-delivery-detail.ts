import { useQuery } from "@tanstack/react-query";
import { getQueryErrorMessage } from "@/utils/query-client";
import { deliveryDetailQuery } from "../services/github-delivery-service";
import type { DeliveryKind } from "../types/github-delivery.types";

const DEPLOYMENT_POLL_INTERVAL_MS = 30_000;

export function useDeliveryDetail(
  kind: DeliveryKind,
  repoPath: string,
  id: number | undefined,
  active: boolean,
) {
  const query = useQuery({
    ...deliveryDetailQuery(kind, repoPath, id),
    refetchInterval: kind === "deployments" && active ? DEPLOYMENT_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: active,
  });

  return {
    data: query.data ?? null,
    error: getQueryErrorMessage(query.error),
    loading: query.isFetching,
    refresh: () => void query.refetch(),
  };
}
