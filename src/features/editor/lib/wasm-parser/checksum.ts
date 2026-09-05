export async function computeWasmChecksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isWasmChecksumValid(bytes: Uint8Array, checksum: string): Promise<boolean> {
  if (!checksum) return true;
  return (await computeWasmChecksum(bytes)) === checksum.toLowerCase();
}
