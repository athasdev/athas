import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/utils/query-client";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import type { CloudAgentRun } from "../services/cloud-agents-api";
import { cloudAgentRunsQuery } from "../services/cloud-agents-queries";

const NO_RUNS: CloudAgentRun[] = [];

/** Every cloud run of the user, kept fresh while one is working. */
export function useCloudRuns() {
  const { hasCloudAgents } = useProFeature();
  const query = useQuery(cloudAgentRunsQuery(hasCloudAgents), queryClient);
  return { runs: query.data ?? NO_RUNS, isLoading: query.isLoading, error: query.error };
}

export function useCloudRun(runId: string | null | undefined): CloudAgentRun | null {
  const { hasCloudAgents } = useProFeature();
  const { data } = useQuery(
    {
      ...cloudAgentRunsQuery(hasCloudAgents && Boolean(runId)),
      select: (runs) => runs.find((run) => run.id === runId) ?? null,
    },
    queryClient,
  );
  return data ?? null;
}
