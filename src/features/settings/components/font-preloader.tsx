import { useEffect } from "react";
import { useFontStore } from "@/stores/font-store";

export const FontPreloader = () => {
  const monospaceFonts = useFontStore.use.monospaceFonts();
  const { loadMonospaceFonts } = useFontStore.use.actions();

  useEffect(() => {
    // Load fonts on component mount
    loadMonospaceFonts();
  }, [loadMonospaceFonts]);

  useEffect(() => {
    // Preload fonts by creating hidden elements to trigger font loading
    if (monospaceFonts.length > 0) {
      const preloadDiv = document.createElement("div");
      preloadDiv.style.position = "absolute";
      preloadDiv.style.top = "-9999px";
      preloadDiv.style.left = "-9999px";
      preloadDiv.style.opacity = "0";
      preloadDiv.style.pointerEvents = "none";

      monospaceFonts.forEach((font) => {
        const span = document.createElement("span");
        span.style.fontFamily = `"${font.family}", monospace`;
        span.textContent = "Font loading test";
        preloadDiv.appendChild(span);
      });

      document.body.appendChild(preloadDiv);

      // Remove after a short delay to ensure fonts are loaded
      setTimeout(() => {
        if (document.body.contains(preloadDiv)) {
          document.body.removeChild(preloadDiv);
        }
      }, 1000);
    }
  }, [monospaceFonts]);

  // Create dynamic font-face CSS for system fonts
  useEffect(() => {
    if (monospaceFonts.length > 0) {
      const style = document.createElement("style");
      style.id = "font-preloader-styles";

      const fontFaces = monospaceFonts
        .map(
          (font) => `
        @font-face {
          font-family: "${font.family}";
          font-display: swap;
          src: local("${font.family}"), local("${font.name}");
        }
      `,
        )
        .join("\n");

      style.textContent = fontFaces;

      // Remove existing style if present
      const existing = document.getElementById("font-preloader-styles");
      if (existing) {
        existing.remove();
      }

      document.head.appendChild(style);

      return () => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      };
    }
  }, [monospaceFonts]);

  return null;
};
