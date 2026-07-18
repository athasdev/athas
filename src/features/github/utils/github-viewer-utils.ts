import { toast } from "sonner";
import { formatCompactRelativeDate } from "@/utils/date";
import { writeClipboardText } from "@/utils/clipboard";

export function getTimeAgo(dateString: string): string {
  return formatCompactRelativeDate(dateString, { afterWeek: "weeks" });
}

export async function copyToClipboard(value: string, successMessage: string) {
  try {
    await writeClipboardText(value);
    toast.success(successMessage);
  } catch (error) {
    toast.error(`Failed to copy: ${String(error)}`);
  }
}
