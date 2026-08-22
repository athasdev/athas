export interface AdminDataSource {
  id: string;
  name: string;
  url: string;
  rowsPath: string;
  authentication: "none" | "github";
}

export interface AdminDataTable {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}
