import { createSqlStore } from "../../sql/stores/create-sql.store";

export const createDuckdbStore = () => createSqlStore("duckdb", "file");
