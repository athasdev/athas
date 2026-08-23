/**
 * SHA-256 integrity helpers for cached Tree-sitter WASM parsers.
 * Uses WebCrypto, available in all Tauri webviews and Node >= 15.
 */

export async function computeWasmChecksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify cached parser bytes against a stored checksum.
 * Entries written before checksums were recorded store an empty string;
 * those are treated as valid to keep legacy caches readable.
 */
export async function isWasmChecksumValid(bytes: Uint8Array, checksum: string): Promise<boolean> {
  if (!checksum) {
    return true;
  }

  const actual = await computeWasmChecksum(bytes);
  return actual === checksum.toLowerCase();
}
