const LOCAL_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "::1"]);
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "about:"]);

function stripControlCharacters(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function isIpv4Address(hostname: string) {
  const segments = hostname.split(".");
  if (segments.length !== 4) return false;

  return segments.every((segment) => {
    if (!/^\d+$/.test(segment)) return false;
    const value = Number.parseInt(segment, 10);
    return value >= 0 && value <= 255;
  });
}

function isPrivateIpv4(hostname: string) {
  if (!isIpv4Address(hostname)) return false;

  const [first, second] = hostname.split(".").map((segment) => Number.parseInt(segment, 10));
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isLikelyLocalHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(normalizedHostname) ||
    normalizedHostname.endsWith(".local") ||
    isPrivateIpv4(normalizedHostname)
  );
}

function hasSupportedProtocol(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function inferProtocol(value: string) {
  const normalizedValue = value.toLowerCase();
  if (
    normalizedValue.startsWith("localhost") ||
    normalizedValue.startsWith("127.") ||
    normalizedValue.startsWith("10.") ||
    normalizedValue.startsWith("192.168.") ||
    normalizedValue.startsWith("172.") ||
    normalizedValue.startsWith("[::1]") ||
    normalizedValue.startsWith("::1") ||
    normalizedValue.startsWith("0.0.0.0") ||
    normalizedValue.startsWith(":")
  ) {
    return "http://";
  }

  return "https://";
}

function tryParseUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeWebViewerUrl(url: string): string {
  const sanitized = stripControlCharacters(url);
  if (!sanitized || /\s/.test(sanitized)) return "";

  if (sanitized === "about:blank") {
    return sanitized;
  }

  const normalizedInput = sanitized.startsWith("//")
    ? `https:${sanitized}`
    : sanitized.startsWith(":")
      ? `http://localhost${sanitized}`
      : sanitized;

  const candidate = hasSupportedProtocol(normalizedInput)
    ? normalizedInput
    : `${inferProtocol(normalizedInput)}${normalizedInput}`;

  const parsed = tryParseUrl(candidate);
  if (!parsed) return "";

  if (parsed.protocol === "about:") {
    return parsed.toString();
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

export function getWebViewerSecurity(url: string): {
  isLocalhost: boolean;
  isSecure: boolean;
  tooltip: string;
  toneClass: string;
} {
  const parsed = tryParseUrl(url);
  if (!parsed) {
    return {
      isLocalhost: false,
      isSecure: false,
      tooltip: "Enter a valid URL",
      toneClass: "text-text-lighter",
    };
  }

  if (parsed.protocol === "about:") {
    return {
      isLocalhost: false,
      isSecure: true,
      tooltip: "Local browser page",
      toneClass: "text-text-lighter",
    };
  }

  const isLocalhost = isLikelyLocalHostname(parsed.hostname);
  const isSecure = parsed.protocol === "https:";

  return {
    isLocalhost,
    isSecure,
    tooltip: isLocalhost
      ? "Local or private network connection"
      : isSecure
        ? "Secure connection (HTTPS)"
        : "Not secure (HTTP)",
    toneClass: isLocalhost ? "text-info" : isSecure ? "text-success" : "text-warning",
  };
}
