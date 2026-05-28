import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "@/ui/toast";

export function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export async function copyToClipboard(value: string, successMessage: string) {
  try {
    await writeText(value);
    toast.success(successMessage);
  } catch {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      toast.error(`Failed to copy: ${String(error)}`);
    }
  }
}
