const GITHUB_AUTH_MIGRATION_NOTICE_KEY = "athas-github-auth-migration-notice-dismissed";

export function isGitHubAuthMigrationNoticeDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(GITHUB_AUTH_MIGRATION_NOTICE_KEY) === "true";
  } catch {
    return false;
  }
}

export function dismissGitHubAuthMigrationNotice(): void {
  try {
    globalThis.localStorage?.setItem(GITHUB_AUTH_MIGRATION_NOTICE_KEY, "true");
  } catch {
    // Ignore localStorage failures.
  }
}
