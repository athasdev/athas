import type { SettingsTab } from "@/stores/ui-state-store";

export interface SettingSearchRecord {
  id: string;
  tab: SettingsTab;
  section: string;
  label: string;
  description: string;
  keywords?: string[];
}

export interface SearchResult extends SettingSearchRecord {
  score: number;
}

export interface SearchState {
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  selectedResultId: string | null;
}
