import { createConnectionSqlViewer } from "../sql/sql-provider-viewer";
import { usePostgresStore } from "./stores/postgres-store";

export default createConnectionSqlViewer("postgres", usePostgresStore);
