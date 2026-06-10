export interface Reference {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  lineContent: string;
}

export interface ReferencesQuery {
  symbol: string;
  filePath: string;
  line: number;
  column: number;
}
