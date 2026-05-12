import { forwardRef, useMemo } from "react";
import type { CodesnapSettings, SourceSnapshot } from "../types";
import type { Line } from "../lib/build-token-spans";
import "../styles/preview-frame.css";

type Props = {
  snapshot: SourceSnapshot;
  settings: CodesnapSettings;
  width: number;
  lines: Line[];
};

export const PreviewFrame = forwardRef<HTMLDivElement, Props>(function PreviewFrame(
  { snapshot, settings, width, lines },
  ref,
) {
  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      width,
      padding: settings.containerPadding,
      background: settings.transparentBackground ? "transparent" : settings.backgroundColor,
      boxShadow: settings.boxShadow,
      borderRadius: settings.roundedCorners ? 12 : 0,
    }),
    [width, settings],
  );

  const windowStyle: React.CSSProperties = {
    background: "var(--codesnap-window-bg, #1a1a1a)",
    borderRadius: settings.roundedCorners ? 8 : 0,
    overflow: "hidden",
  };

  const showHeader = settings.showWindowControls || settings.showWindowTitle;

  return (
    <div ref={ref} className="codesnap-frame" style={containerStyle}>
      <div className="codesnap-window" style={windowStyle}>
        {showHeader && (
          <div className="codesnap-chrome">
            {settings.showWindowControls && (
              <div className="codesnap-dots">
                <span className="codesnap-dot codesnap-dot--red" />
                <span className="codesnap-dot codesnap-dot--yellow" />
                <span className="codesnap-dot codesnap-dot--green" />
              </div>
            )}
            {settings.showWindowTitle && (
              <div className="codesnap-title">{snapshot.bufferPath ?? "untitled"}</div>
            )}
          </div>
        )}
        <pre className="codesnap-code" style={{ fontFamily: settings.fontFamily, margin: 0 }}>
          {lines.map((line, idx) => (
            <div key={idx} className="codesnap-line">
              {settings.showLineNumbers && (
                <span className="codesnap-ln">
                  {settings.realLineNumbers ? snapshot.startLine + idx : idx + 1}
                </span>
              )}
              {line.map((span, i) => (
                <span key={i} className={span.className}>
                  {span.text}
                </span>
              ))}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
});
