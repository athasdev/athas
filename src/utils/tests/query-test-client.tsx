import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../query-client";

/** A fresh client per test, without retries so failures surface on the first attempt. */
export function createTestQueryClient() {
  return createQueryClient({ queries: { retry: false }, mutations: { retry: false } });
}

export function createQueryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
