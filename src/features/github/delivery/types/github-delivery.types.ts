import type {
  DeliveryUser,
  DeploymentStatus,
  ReleaseAsset,
  ReleaseInput,
} from "@/bindings/commands";

export type { DeliveryUser, DeploymentStatus, ReleaseAsset, ReleaseInput };

export type DeliveryKind = "releases" | "deployments";
export type ReleaseFilter = "all" | "published" | "draft" | "prerelease";
export type DeploymentFilter = "all" | "active" | "pending" | "failed" | "inactive";

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
