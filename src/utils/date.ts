export const formatRelativeTime = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diff = (Date.now() - date.getTime()) / 1000;

  if (diff < 60) return rtf.format(-Math.round(diff), "second");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 2592000) return rtf.format(-Math.round(diff / 86400), "day");
  return rtf.format(-Math.round(diff / 2592000), "month");
};

export const formatDate = (timestamp: number) => {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(timestamp * 1000)
    .replace(",", "");
};

/**
 * Format a date string to a short date format (e.g., "Jan 20, 2024").
 */
export const formatShortDate = (dateString: string | Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return typeof dateString === "string" ? dateString : "unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

/**
 * Format a date string to a compact relative time format.
 * Returns "just now", "5m ago", "2h ago", "yesterday", "3d ago", or locale date.
 */
export const formatRelativeDate = (dateString: string | Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return typeof dateString === "string" ? dateString : "unknown";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat("en-US").format(date);
};
