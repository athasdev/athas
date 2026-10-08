import { lazy, type LazyExoticComponent, type ComponentType } from "react";
import { PROVIDER_REGISTRY, type DatabaseViewerProps } from "../services/provider-registry";
import type { DatabaseType } from "../types/provider.types";
import { Empty, EmptyDescription } from "@/ui/empty";

const databaseViewerCache = new Map<
  DatabaseType,
  LazyExoticComponent<ComponentType<DatabaseViewerProps>>
>();

function getDatabaseViewer(dbType: DatabaseType) {
  if (!databaseViewerCache.has(dbType)) {
    databaseViewerCache.set(dbType, lazy(PROVIDER_REGISTRY[dbType].viewerComponent));
  }
  return databaseViewerCache.get(dbType)!;
}

interface DatabaseBufferViewProps {
  databaseType: DatabaseType;
  path: string;
  connectionId?: string;
}

/** A database buffer: the viewer of its provider, opened on its file or its connection. */
export function DatabaseBufferView({ databaseType, path, connectionId }: DatabaseBufferViewProps) {
  const config = PROVIDER_REGISTRY[databaseType];
  const DatabaseViewer = getDatabaseViewer(databaseType);
  let viewerProps: DatabaseViewerProps;
  if (config.isFileBased) {
    viewerProps = { databasePath: path };
  } else {
    if (!connectionId) {
      return (
        <Empty className="h-full" tone="error" role="alert">
          <EmptyDescription>Missing database connection</EmptyDescription>
        </Empty>
      );
    }
    viewerProps = { connectionId };
  }
  return <DatabaseViewer {...viewerProps} />;
}
