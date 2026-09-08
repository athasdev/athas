import type {
  Release,
  Deployment,
  DeploymentStatus,
} from "../delivery/types/github-delivery.types";

export const releaseFixture: Release = {
  id: 41,
  tag_name: "v0.14.1",
  name: "Athas 0.14.1",
  target_commitish: "main",
  body: "## A better place to build\n\n- Rich GitHub Actions logs and workflow controls\n- Faster workspace navigation\n- Improved editor stability\n\n### Contributors\nThanks to everyone who tested this release.",
  draft: false,
  prerelease: false,
  immutable: false,
  html_url: "https://github.com/athasdev/athas/releases/tag/v0.14.1",
  created_at: "2026-09-08T09:00:00Z",
  published_at: "2026-09-08T10:00:00Z",
  author: { login: "mehmetozguldev", avatar_url: null },
  zipball_url: "https://api.github.com/repos/athasdev/athas/zipball/v0.14.1",
  tarball_url: null,
  discussion_url: null,
  assets: [
    {
      id: 10,
      name: "Athas_0.14.1_aarch64.dmg",
      label: null,
      size: 89128960,
      download_count: 1234,
      browser_download_url:
        "https://github.com/athasdev/athas/releases/download/v0.14.1/Athas_0.14.1_aarch64.dmg",
      content_type: "application/octet-stream",
      state: "uploaded",
      digest: "sha256:abcdef",
    },
  ],
};

export const deploymentStatusFixture: DeploymentStatus = {
  id: 52,
  state: "success",
  description: "Deployment is ready",
  environment: "Production",
  environment_url: "https://athas.dev",
  log_url: "https://github.com/athasdev/www/actions/runs/123",
  created_at: "2026-09-08T10:05:00Z",
  creator: { login: "github-actions[bot]", avatar_url: null },
};

export const deploymentFixture: Deployment = {
  id: 42,
  sha: "abc1234567890abcdef1234567890abcdef1234567",
  ref: "main",
  task: "deploy",
  environment: "Production",
  description: "Update GitHub integration and release notes",
  created_at: "2026-09-08T10:00:00Z",
  updated_at: "2026-09-08T10:05:00Z",
  creator: { login: "mehmetozguldev", avatar_url: null },
  transient_environment: false,
  production_environment: true,
  status_error: null,
  statuses: [
    deploymentStatusFixture,
    {
      ...deploymentStatusFixture,
      id: 51,
      state: "in_progress",
      description: "Building and uploading assets",
      created_at: "2026-09-08T10:01:00Z",
    },
    {
      ...deploymentStatusFixture,
      id: 50,
      state: "queued",
      description: "Waiting for a runner",
      created_at: "2026-09-08T10:00:00Z",
    },
  ],
};
