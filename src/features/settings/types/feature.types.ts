import type React from "react";

export interface CoreFeature {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
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
  outline: boolean;
  aiChat: boolean;
  teamCollaboration: boolean;
  breadcrumbs: boolean;
  persistentCommands: boolean;
  webViewer: boolean;
}
