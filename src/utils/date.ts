/**
 * Format a Unix timestamp (seconds) to a relative time string.
 * Returns "3 hours ago", "2 days ago", "last month", etc.
 */
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

/**
 * Format a Unix timestamp (seconds) to a locale date-time string.
 * Returns "YYYY-MM-DD HH:MM" (e.g., "2024-01-20 14:30").
 */
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
 * Format a date string to a short date format.
 * Returns "Jan 20, 2024" style output.
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

type DateInput = string | Date | number;

interface CompactRelativeDateOptions {
  afterWeek?: "date" | "days" | "weeks";
  fallback?: string;
  capitalizeJustNow?: boolean;
  justNowLabel?: string;
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Format a date-like value to a compact relative time string.
 * Returns "just now", "5m ago", "2h ago", "3d ago", and optionally weeks.
 */
export const formatCompactRelativeDate = (
  value: DateInput,
  options: CompactRelativeDateOptions = {},
): string => {
  const date = toDate(value);
  const fallback = options.fallback ?? (typeof value === "string" ? value : "unknown");

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const justNow = options.justNowLabel ?? (options.capitalizeJustNow ? "Just now" : "just now");

  if (diffMins < 1) return justNow;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1 && options.afterWeek !== "days") return "yesterday";
  if (diffDays < 7 || options.afterWeek === "days") return `${diffDays}d ago`;
  if (options.afterWeek === "weeks") return `${Math.floor(diffDays / 7)}w ago`;

  return new Intl.DateTimeFormat("en-US").format(date);
};

export const formatCalendarDateGroup = (value: DateInput): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
};

export const formatShortDateTime = (value: DateInput): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const formatTimeOfDay = (value: DateInput): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * Format a date string to a compact relative time format.
 * Returns "just now", "5m ago", "2h ago", "yesterday", "3d ago", or locale date.
 */
export const formatRelativeDate = (dateString: string | Date): string => {
  return formatCompactRelativeDate(dateString);
};
