/**
 * Pages of the athas.dev website the web app links to. The app is served from the website's own
 * origin under /app, so these are plain same-origin paths.
 */
export const WEBSITE_PAGES = {
  dashboard: "/dashboard",
  account: "/dashboard/settings/account",
  billing: "/dashboard/settings/billing",
  integrations: "/dashboard/settings/integrations",
  docs: "/docs",
} as const;

/** The sign-in page, returning to where the user is in the app afterwards. */
export function getSignInUrl(location: Pick<Location, "pathname" | "search"> = window.location) {
  const next = location.pathname.startsWith("/app")
    ? `${location.pathname}${location.search}`
    : "/app";
  return `/auth/sign-in?next=${encodeURIComponent(next)}`;
}

/** Leaves the app for the sign-in page; it brings the user back once signed in. */
export function goToSignIn() {
  window.location.assign(getSignInUrl());
}

/**
 * Opens a website page in a new tab, so a repository open in the app stays connected while the
 * user changes their plan or connects GitHub.
 */
export function openWebsitePage(path: string) {
  window.open(path, "_blank", "noopener");
}
