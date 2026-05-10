import { createSqlStore } from "../../sql/create-sql-store";

export const useSqliteStore = createSqlStore("sqlite", "file");
