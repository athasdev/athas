export type DeliveryKind = "releases" | "deployments";
export type ReleaseFilter = "all" | "published" | "draft" | "prerelease";
export type DeploymentFilter = "all" | "active" | "pending" | "failed" | "inactive";

export interface DeliveryUser {
  login: string;
  avatar_url: string | null;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  label: string | null;
  size: number;
  download_count: number;
  browser_download_url: string;
  content_type: string;
  state: string;
  digest: string | null;
}

export interface Release {
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  html_url: string;
  created_at: string;
  published_at: string | null;
  author: DeliveryUser | null;
  assets: ReleaseAsset[];
  zipball_url: string | null;
  tarball_url: string | null;
  discussion_url: string | null;
}

export interface ReleaseInput {
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
  prerelease: boolean;
}

export interface DeploymentStatus {
  id: number;
  state: string;
  description: string | null;
  environment: string | null;
  environment_url: string | null;
  log_url: string | null;
  created_at: string;
  creator: DeliveryUser | null;
}

export interface Deployment {
  id: number;
  sha: string;
  ref: string;
  task: string;
  environment: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  creator: DeliveryUser | null;
  transient_environment: boolean;
  production_environment: boolean;
  statuses: DeploymentStatus[];
  status_error: string | null;
}

export type DeliveryResource = Release | Deployment;
