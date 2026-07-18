export interface ThemeFile {
  $schema?: string;
  name: string;
  author?: string;
  description?: string;
  repository?: string;
  license?: string;
  version?: string;
  themes: Theme[];
}

export interface Theme {
  id: string;
  name: string;
  description?: string;
  appearance: "dark" | "light";
  colors: Record<string, string>;
  syntax?: Record<string, string>;
}
