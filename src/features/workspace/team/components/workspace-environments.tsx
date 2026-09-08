import { useEffect, useState } from "react";
import {
  loadRemoteConnections,
  connectRemoteConnection,
} from "@/features/remote/services/remote-connection-actions";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { FieldDescription } from "@/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import { ResourceContentSection } from "@/ui/resource";
import {
  inspectWorkspaceEnvironment,
  type WorkspaceEnvironmentInfo,
} from "../services/workspace-environment";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceEnvironments({ root, reportError }: WorkspaceSectionProps) {
  const [info, setInfo] = useState<WorkspaceEnvironmentInfo | null>(null);
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    void Promise.all([inspectWorkspaceEnvironment(root), loadRemoteConnections()])
      .then(([environment, remotes]) => {
        if (!cancelled) {
          setInfo(environment);
          setConnections(remotes);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) reportError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root, revision, reportError]);
  const connect = async (connection: RemoteConnection) => {
    if (connecting) return;
    setConnecting(connection.id);
    try {
      await connectRemoteConnection(connection);
    } catch (error) {
      reportError(error);
    } finally {
      setConnecting(null);
    }
  };
  return (
    <div className="space-y-6">
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>
            {info
              ? { local: "Local environment", remote: "SSH environment", wsl: "WSL environment" }[
                  info.kind
                ]
              : "Workspace environment"}
          </ItemTitle>
          <ItemDescription className="break-all">{root}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            {loading ? "Inspecting…" : "Refresh"}
          </Button>
        </ItemActions>
      </Item>
      <ResourceContentSection title="Declared tool requirements">
        <FieldDescription>
          Read from project manifests. These are the project's requirements; installed versions have
          not been verified.
        </FieldDescription>
        {info?.requirements.map((requirement, index) => (
          <Item key={index}>
            <ItemContent>
              <ItemTitle>{requirement.name}</ItemTitle>
              <ItemDescription>{requirement.version}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
        {info && !info.requirements.length ? (
          <FieldDescription>
            No runtime requirements found in the supported project manifests.
          </FieldDescription>
        ) : null}
      </ResourceContentSection>
      <ResourceContentSection title="Saved SSH connections on this device">
        <FieldDescription>
          Open a saved remote environment using Athas's existing SSH connection and authentication
          flow.
        </FieldDescription>
        {connections.map((connection) => (
          <Item key={connection.id} variant="muted">
            <ItemContent>
              <ItemTitle>{connection.name}</ItemTitle>
              <ItemDescription>
                {connection.username ? `${connection.username}@` : ""}
                {connection.host}:{connection.port}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button disabled={!!connecting} onClick={() => void connect(connection)}>
                {connecting === connection.id ? "Connecting…" : "Connect"}
              </Button>
            </ItemActions>
          </Item>
        ))}
        {!loading && !connections.length ? (
          <FieldDescription>No saved SSH connections.</FieldDescription>
        ) : null}
        <Button onClick={() => useUIState.getState().openProjectPicker("addRemote")}>
          Add SSH connection
        </Button>
      </ResourceContentSection>
      {info?.files.includes(".devcontainer") || info?.files.includes(".devcontainer.json") ? (
        <FieldDescription>
          This project contains Dev Container configuration. Starting a Dev Container from Athas is
          not supported yet.
        </FieldDescription>
      ) : null}
    </div>
  );
}
