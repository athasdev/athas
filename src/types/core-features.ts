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
}

export const DEFAULT_CORE_FEATURES: CoreFeaturesState = {
  git: true,
  remote: true,
  terminal: true,
  search: true,
  diagnostics: true,
  aiChat: true,
};
