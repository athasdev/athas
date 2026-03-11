import { Lock, Shield, ShieldAlert, type LucideIcon } from "lucide-react";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (trimmed.match(/^https?:\/\//)) return trimmed;

  const isLocal =
    trimmed.toLowerCase().startsWith("localhost") ||
    trimmed.toLowerCase().startsWith("127.0.0.1");

  return isLocal ? `http://${trimmed}` : `https://${trimmed}`;
}

export function getSecurityInfo(url: string): {
  icon: LucideIcon;
  color: string;
  tooltip: string;
} {
  const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
  const isSecure = url.startsWith("https://");

  if (isLocalhost) {
    return { icon: Shield, color: "text-info", tooltip: "Local development server" };
  }
  if (isSecure) {
    return { icon: Lock, color: "text-success", tooltip: "Secure connection (HTTPS)" };
  }
  return { icon: ShieldAlert, color: "text-warning", tooltip: "Not secure (HTTP)" };
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
