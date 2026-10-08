import { queryOptions } from "@tanstack/react-query";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { isActiveCloudAgentRun, listCloudAgentRuns } from "./cloud-agents-api";

export const cloudAgentKeys = {
  all: ["cloud-agents"] as const,
  runs: () => [...cloudAgentKeys.all, "runs"] as const,
  providerKey: (providerId: string) => [...cloudAgentKeys.all, "provider-key", providerId] as const,
};

export function cloudAgentRunsQuery(enabled: boolean) {
  return queryOptions({
    queryKey: cloudAgentKeys.runs(),
    queryFn: listCloudAgentRuns,
    enabled,
    refetchInterval: (query) => (query.state.data?.some(isActiveCloudAgentRun) ? 5000 : false),
  });
}

/** Whether a provider key is saved, without keeping the key in the query cache. */
export function providerKeyQuery(providerId: "anthropic" | "openai") {
  return queryOptions({
    queryKey: cloudAgentKeys.providerKey(providerId),
    queryFn: async () => Boolean(await getProviderApiToken(providerId)),
  });
}
