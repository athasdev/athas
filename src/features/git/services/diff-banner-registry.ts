import type { ComponentType } from "react";

export interface DiffBannerProps {
  bufferId: string;
}

const banners = new Map<string, ComponentType<DiffBannerProps>>();

/**
 * Shows `component` above multi-file diffs whose `commitHash` is `kind`. Features that open their
 * own diffs (a proposal waiting for review) use it to add controls without the viewer knowing them.
 */
export function registerDiffBanner(kind: string, component: ComponentType<DiffBannerProps>) {
  banners.set(kind, component);
}

export function getDiffBanner(kind: string): ComponentType<DiffBannerProps> | null {
  return banners.get(kind) ?? null;
}
