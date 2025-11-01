import type React from "react";

export interface CoreFeature {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  enabled: boolean;
}

export interface CoreFeaturesState {
  git: boolean;
  remote: boolean;
  terminal: boolean;
  search: boolean;
  diagnostics: boolean;
  aiChat: boolean;
  breadcrumbs: boolean;
}
