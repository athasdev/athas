interface CustomViewDefinitionBase {
  id: string;
  name: string;
  rowsPath: string;
  presentation?: ViewPresentation;
}

export type ViewLayout = "table" | "list" | "board";

export interface ViewPresentation {
  layout: ViewLayout;
  groupBy?: string | null;
  titleColumn?: string;
  descriptionColumn?: string;
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
