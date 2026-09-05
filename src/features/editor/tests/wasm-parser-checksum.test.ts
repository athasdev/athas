import { describe, expect, it } from "vite-plus/test";
import { computeWasmChecksum, isWasmChecksumValid } from "../lib/wasm-parser/checksum";

const encoder = new TextEncoder();

describe("computeWasmChecksum", () => {
  it("hashes only the selected byte range of a larger backing buffer", async () => {
    const bytes = encoder.encode("prefixabcsuffix").subarray(6, 9);
    await expect(computeWasmChecksum(bytes)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces the known SHA-256 digest for a byte sequence", async () => {
    const checksum = await computeWasmChecksum(encoder.encode("abc"));

    expect(checksum).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns a 64 character lowercase hex string for empty content", async () => {
    const checksum = await computeWasmChecksum(new Uint8Array(0));

    expect(checksum).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(checksum).toHaveLength(64);
  });
});

describe("isWasmChecksumValid", () => {
  it("accepts bytes whose checksum matches the stored value", async () => {
    const bytes = encoder.encode("parser-bytes");
    const checksum = await computeWasmChecksum(bytes);

    await expect(isWasmChecksumValid(bytes, checksum)).resolves.toBe(true);
  });

  it("rejects bytes that no longer match the stored checksum", async () => {
    const bytes = encoder.encode("parser-bytes");
    const otherChecksum = await computeWasmChecksum(encoder.encode("tampered"));

    await expect(isWasmChecksumValid(bytes, otherChecksum)).resolves.toBe(false);
  });

  it("treats legacy entries without a stored checksum as valid", async () => {
    await expect(isWasmChecksumValid(encoder.encode("anything"), "")).resolves.toBe(true);
  });
});
