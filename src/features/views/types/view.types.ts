interface CustomViewDefinitionBase {
  id: string;
  name: string;
  rowsPath: string;
}

export type CustomViewDefinition = CustomViewDefinitionBase &
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

export interface ViewTable {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}
