import { createSqlStore } from "../../sql/stores/create-sql.store";

export const useSqliteStore = createSqlStore("sqlite", "file");
