import { formatCompactRelativeDate, formatTimeOfDay } from "@/utils/date";

// Get relative time string
export const getRelativeTime = (date: Date): string => {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return formatCompactRelativeDate(date, { justNowLabel: "now" });
};

// Format time for display
export const formatTime = (date: Date): string => {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  return formatTimeOfDay(date);
};
