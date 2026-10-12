import type { ComponentType } from "react";

/**
 * Components the web app (athas.dev/app) mounts in the workbench chrome. Its entry registers them
 * before the app renders, so the desktop build never imports the web workbench.
 */
export interface WebContributions {
  AccountMenu?: ComponentType;
  GithubRepositoryContent?: ComponentType<{ onBack: () => void; onClose: () => void }>;
}

const contributions: WebContributions = {};

export function registerWebContributions(next: WebContributions) {
  Object.assign(contributions, next);
}

export function getWebContributions(): Readonly<WebContributions> {
  return contributions;
}
