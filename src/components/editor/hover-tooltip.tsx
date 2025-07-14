import { useEditorConfigStore } from "../../stores/editor-config";
import { useEditorInstanceStore } from "../../stores/editor-instance";

export function HoverTooltip() {
  const fontSize = useEditorConfigStore(state => state.fontSize);
  const { hoverInfo, handleMouseEnter, handleMouseLeave } = useEditorInstanceStore();

  if (!hoverInfo?.visible) return null;

  return (
    <div
      className="fixed z-50 max-w-md rounded border border-border bg-primary-bg p-3 shadow-lg"
      style={{
        left: hoverInfo.position?.x || 0,
        top: hoverInfo.position?.y || 0,
        fontSize: `${fontSize * 0.9}px`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hoverInfo.contents && (
        <div className="space-y-2">
          {Array.isArray(hoverInfo.contents) ? (
            hoverInfo.contents.map((content: any, index: number) => (
              <div key={index} className="text-sm">
                {typeof content === "string" ? (
                  <span className="font-mono text-text">{content}</span>
                ) : content.language ? (
                  <pre className="rounded bg-secondary-bg p-2 font-mono text-xs">
                    <code>{content.value}</code>
                  </pre>
                ) : (
                  <div className="text-text-light">{content.value || content}</div>
                )}
              </div>
            ))
          ) : (
            <div className="text-sm text-text">{hoverInfo.contents}</div>
          )}
        </div>
      )}
    </div>
  );
}
