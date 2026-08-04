import { createFileSqlViewer } from "../sql/sql-provider-viewer";
import { createDuckdbStore } from "./stores/duckdb.store";

export default createFileSqlViewer("duckdb", createDuckdbStore);
