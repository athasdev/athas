interface AdminDataSourceBase {
  id: string;
  name: string;
  rowsPath: string;
}

export type AdminDataSource = AdminDataSourceBase &
  (
    | {
        kind: "github";
        endpointPath: string;
      }
    | {
        kind: "json";
        url: string;
        authentication: "none" | "github";
      }
  );

export interface AdminDataTable {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}
