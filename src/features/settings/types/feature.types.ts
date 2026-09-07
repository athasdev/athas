import type { Icon } from "@/ui/icons";

export interface CoreFeature {
  id: string;
  name: string;
  description: string;
  icon: Icon;
  enabled: boolean;
  status?: "experimental";
}

export interface CoreFeaturesState {
  git: boolean;
  github: boolean;
  remote: boolean;
  terminal: boolean;
  search: boolean;
  diagnostics: boolean;
  debugger: boolean;
  docker: boolean;
  aiChat: boolean;
  teamCollaboration: boolean;
  breadcrumbs: boolean;
  persistentCommands: boolean;
}
