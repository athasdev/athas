import { toBlob } from "html-to-image";
import { getEmbeddedFontCss } from "./font-embed";

export async function renderPng(node: HTMLElement, pixelRatio: number): Promise<Blob> {
  const fontEmbedCSS = await getEmbeddedFontCss();
  const blob = await toBlob(node, {
    pixelRatio,
    fontEmbedCSS,
    cacheBust: false,
    backgroundColor: undefined,
    style: { transform: "none" },
  });
  if (!blob) throw new Error("renderPng: html-to-image returned null");
  return blob;
}
