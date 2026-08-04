import { createConnectionSqlViewer } from "../sql/sql-provider-viewer";
import { createPostgresStore } from "./stores/postgres.store";

export default createConnectionSqlViewer("postgres", createPostgresStore);
