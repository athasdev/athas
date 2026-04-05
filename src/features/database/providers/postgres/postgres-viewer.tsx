import SqlDatabaseViewer from "../sql/sql-database-viewer";
import { usePostgresStore } from "./stores/postgres-store";

interface PostgresViewerProps {
  connectionId: string;
}

export default function PostgresViewer({ connectionId }: PostgresViewerProps) {
  return (
    <SqlDatabaseViewer
      connectionId={connectionId}
      databaseType="postgres"
      useStore={usePostgresStore}
    />
  );
}
