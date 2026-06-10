import { createSqlStore } from "../../sql/stores/create-sql.store";

export const useDuckdbStore = createSqlStore("duckdb", "file");
