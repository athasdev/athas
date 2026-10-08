import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getQueryErrorMessage } from "@/utils/query-client";
import { deliveryListQuery } from "../services/github-delivery-service";
import type { DeliveryKind, DeliveryResource } from "../types/github-delivery.types";

const EMPTY_ITEMS: DeliveryResource[] = [];

export function useDeliveryList(kind: DeliveryKind, repoPath: string, enabled: boolean) {
  const query = useInfiniteQuery({ ...deliveryListQuery(kind, repoPath), enabled });
  const pages = query.data?.pages;
  const items = useMemo(() => {
    if (!pages) return EMPTY_ITEMS;
    // A release published between two page loads shifts the pages, so an item can appear twice.
    const seen = new Set<number>();
    return pages.flat().filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [pages]);

  return {
    items,
    loading: query.isFetching,
    error: getQueryErrorMessage(query.error),
    hasMore: query.hasNextPage,
    refresh: () => void query.refetch(),
    loadMore: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}
