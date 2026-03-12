import { createSqlStore } from "../../sql/create-sql-store";

export const useDuckdbStore = createSqlStore("duckdb", "file");
