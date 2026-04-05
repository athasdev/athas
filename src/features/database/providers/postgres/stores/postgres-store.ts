import { createSqlStore } from "../../sql/create-sql-store";

export const usePostgresStore = createSqlStore("postgres", "connection");
