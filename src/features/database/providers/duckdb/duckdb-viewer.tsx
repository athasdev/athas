import { createFileSqlViewer } from "../sql/sql-provider-viewer";
import { useDuckdbStore } from "./stores/duckdb-store";

export default createFileSqlViewer("duckdb", useDuckdbStore);
