import { invoke } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { buildDefaultFilename } from "./build-default-filename";
import type { SourceSnapshot } from "../types";

export async function copyToClipboard(png: Blob): Promise<void> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  // Decode the PNG into a Tauri Image resource (needs the `image-png` cargo feature).
  const image = await Image.fromBytes(bytes);
  try {
    // We invoke the plugin command directly rather than calling the plugin's
    // writeImage wrapper. The wrapper does an `instanceof Image` check, but the
    // clipboard-manager plugin bundles its own nested @tauri-apps/api copy, so
    // the check fails for our Image instance and the payload ends up as an
    // unrecognised JsImage variant. Passing the resource id directly matches
    // the Rust-side `JsImage::Resource(u32)` variant cleanly.
    await invoke("plugin:clipboard-manager|write_image", { image: image.rid });
  } finally {
    // The resource is owned by Rust; closing it frees the decoded pixel buffer.
    await image.close().catch(() => {});
  }
}

export async function saveToFile(png: Blob, snapshot: SourceSnapshot): Promise<string | null> {
  const defaultPath = buildDefaultFilename(snapshot);
  const target = await save({
    defaultPath,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (!target) return null;
  const bytes = new Uint8Array(await png.arrayBuffer());
  await writeFile(target, bytes);
  return target;
}
