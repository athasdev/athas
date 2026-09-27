import { EmptyState } from "@/ui/empty";
import { ResourceContent, ResourceSection } from "@/ui/resource";
import { summarizeInitialize } from "../lib/acp-traffic-messages";
import type { AcpInitializeExchange } from "../types/acp-traffic.types";
import { AcpJsonBlock } from "./acp-json-block";

interface AcpCapabilitiesPanelProps {
  initialize: AcpInitializeExchange;
}

/** What each side declared in `initialize`, and the raw request and response. */
export function AcpCapabilitiesPanel({ initialize }: AcpCapabilitiesPanelProps) {
  if (!initialize.request) {
    return (
      <EmptyState className="min-h-40" message="This agent process has not sent initialize yet." />
    );
  }

  const summary = summarizeInitialize(initialize);
  const waiting = initialize.response ? undefined : "Waiting for the agent";

  return (
    <ResourceContent>
      <div className="flex flex-col gap-8">
        {summary.error ? (
          <ResourceSection title="Initialize error">
            <AcpJsonBlock value={summary.error} />
          </ResourceSection>
        ) : null}
        <ResourceSection title="Protocol version">
          <AcpJsonBlock value={summary.protocolVersion} emptyLabel={waiting} />
        </ResourceSection>
        <ResourceSection title="Agent info">
          <AcpJsonBlock value={summary.agentInfo} emptyLabel={waiting} />
        </ResourceSection>
        <ResourceSection title="Agent capabilities">
          <AcpJsonBlock value={summary.agentCapabilities} emptyLabel={waiting} />
        </ResourceSection>
        <ResourceSection title="Auth methods">
          <AcpJsonBlock value={summary.authMethods} emptyLabel={waiting ?? "None"} />
        </ResourceSection>
        <ResourceSection title="Client info">
          <AcpJsonBlock value={summary.clientInfo} />
        </ResourceSection>
        <ResourceSection title="Client capabilities">
          <AcpJsonBlock value={summary.clientCapabilities} />
        </ResourceSection>
        <ResourceSection title="Initialize request">
          <AcpJsonBlock value={initialize.request} />
        </ResourceSection>
        <ResourceSection title="Initialize response">
          <AcpJsonBlock value={initialize.response} emptyLabel={waiting} />
        </ResourceSection>
      </div>
    </ResourceContent>
  );
}
