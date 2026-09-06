import type { FontInfo } from "@/features/settings/types/font.types";
import {
  DEFAULT_HEADING_FONT_FAMILY,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "./typography-defaults";

export const BUNDLED_FONTS: FontInfo[] = [
  DEFAULT_UI_FONT_FAMILY,
  DEFAULT_HEADING_FONT_FAMILY,
  DEFAULT_MONO_FONT_FAMILY,
].map((family) => ({
  name: family,
  family,
  style: "Regular",
  is_monospace: family === DEFAULT_MONO_FONT_FAMILY,
}));
