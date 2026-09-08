import { openDeploymentLog } from "../services/open-deployment-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { RocketIcon, OpenExternalIcon } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import {
  ResourceContentSection,
  ResourceDetailLayout,
  ResourceDetailSection,
  ResourceDetailSidebar,
} from "@/ui/resource";
import { GitHubResourceSummary, GitHubUserChip } from "../../components/github-resource-chips";
import { getTimeAgo } from "../../utils/github-viewer-utils";
import type { Deployment } from "../types/github-delivery.types";
import { deploymentState, deploymentStatusState, safeDeliveryUrl } from "../utils/github-delivery";

export function DeploymentDetails({ deployment }: { deployment: Deployment }) {
  const state = deploymentState(deployment);
  const latest = deployment.statuses[0];
  const environmentUrl = safeDeliveryUrl(latest?.environment_url);
  const open = (url: string) => {
    void openUrl(url).catch((error) => toast.error(String(error)));
  };
  return (
    <ResourceDetailLayout
      sidebar={
        <ResourceDetailSidebar>
          <ResourceDetailSection label="Status">
            <Badge variant={state.tone}>{state.label}</Badge>
          </ResourceDetailSection>
          <ResourceDetailSection label="Environment">
            <div className="space-y-2">
              <span className="break-all">{latest?.environment || deployment.environment}</span>
              <div className="flex flex-wrap gap-2">
                {deployment.production_environment && <Badge variant="accent">Production</Badge>}
                {deployment.transient_environment && <Badge>Preview</Badge>}
              </div>
            </div>
          </ResourceDetailSection>
          <ResourceDetailSection label="Reference">
            <span className="break-all font-mono">{deployment.ref}</span>
          </ResourceDetailSection>
          <ResourceDetailSection label="Commit">
            <span className="break-all font-mono">{deployment.sha}</span>
          </ResourceDetailSection>
          {deployment.creator && (
            <ResourceDetailSection label="Deployed by">
              <GitHubUserChip
                login={deployment.creator.login}
                avatarUrl={deployment.creator.avatar_url}
              />
            </ResourceDetailSection>
          )}
          <ResourceDetailSection label="Task">{deployment.task}</ResourceDetailSection>
          <ResourceDetailSection label="Created">
            <time dateTime={deployment.created_at}>
              {new Date(deployment.created_at).toLocaleString()}
            </time>
          </ResourceDetailSection>
          {environmentUrl && (
            <ResourceDetailSection label="Environment URL">
              <Button variant="ghost" onClick={() => open(environmentUrl)} tooltip={environmentUrl}>
                <OpenExternalIcon /> Open Environment
              </Button>
            </ResourceDetailSection>
          )}
        </ResourceDetailSidebar>
      }
    >
      <div className="space-y-8">
        <GitHubResourceSummary
          title={deployment.environment}
          icon={<RocketIcon className="text-subtle-foreground" />}
          description={
            deployment.description || `${deployment.ref} · ${deployment.sha.slice(0, 7)}`
          }
          badges={<Badge variant={state.tone}>{state.label}</Badge>}
        />
        <ResourceContentSection title={`Status history (${deployment.statuses.length})`}>
          <ItemGroup>
            {deployment.statuses.map((status, index) => {
              const state = deploymentStatusState(status.state);
              const logUrl = safeDeliveryUrl(status.log_url);
              return (
                <Item role="listitem" key={status.id} variant={index === 0 ? "muted" : "default"}>
                  <ItemContent>
                    <ItemTitle>
                      <Badge variant={state.tone}>{state.label}</Badge>
                      {index === 0 ? "Latest" : null}
                    </ItemTitle>
                    <ItemDescription>
                      {status.description || "No status description"}
                    </ItemDescription>
                    <ItemDescription>
                      <time
                        dateTime={status.created_at}
                        title={new Date(status.created_at).toLocaleString()}
                      >
                        {getTimeAgo(status.created_at)}
                      </time>
                      {status.creator ? ` · ${status.creator.login}` : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {logUrl && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void openDeploymentLog(logUrl).catch((error) =>
                            toast.error(String(error)),
                          );
                        }}
                      >
                        <OpenExternalIcon /> Logs
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              );
            })}
            {deployment.statuses.length === 0 && (
              <Item>
                <ItemDescription>
                  Waiting for the deployment provider to report a status. This view refreshes
                  automatically.
                </ItemDescription>
              </Item>
            )}
          </ItemGroup>
        </ResourceContentSection>
      </div>
    </ResourceDetailLayout>
  );
}
