import { createSqlStore } from "../../sql/stores/create-sql.store";

export const usePostgresStore = createSqlStore("postgres", "connection");
