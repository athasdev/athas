import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface MinimapPaneProps {
  content: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fontSize: number;
}

export default function MinimapPane({ content, textareaRef, fontSize }: MinimapPaneProps) {
  const [width, setWidth] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(60);
  const [isViewportDragging, setIsViewportDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartViewportTop, setDragStartViewportTop] = useState(0);

  const minimapRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Constants - improved line visibility
  const lineHeight = Math.max(3, Math.min(6, fontSize * 0.4));
  const headerHeight = 24;
  const minWidth = 80;
  const maxWidth = 200;

  // Memoize lines to avoid recalculation on every render
  const lines = useMemo(() => content.split("\n"), [content]);

  const updateViewportFromTextarea = useCallback(() => {
    if (!textareaRef.current || !minimapRef.current) return;

    const textarea = textareaRef.current;
    const minimap = minimapRef.current;

    const textareaHeight = textarea.clientHeight;
    const textareaScrollTop = textarea.scrollTop;
    const textareaScrollHeight = textarea.scrollHeight;

    // Skip if no scrollable content
    if (textareaScrollHeight <= textareaHeight) {
      setViewportTop(0);
      setViewportHeight(minimap.clientHeight - headerHeight);
      return;
    }

    const minimapContentHeight = minimap.clientHeight - headerHeight;

    // Calculate ratios more accurately
    const scrollRatio = textareaScrollTop / (textareaScrollHeight - textareaHeight);
    const visibleRatio = textareaHeight / textareaScrollHeight;

    // Calculate viewport dimensions
    const newViewportHeight = Math.max(15, visibleRatio * minimapContentHeight);
    const availableScrollSpace = minimapContentHeight - newViewportHeight;
    const newViewportTop = scrollRatio * availableScrollSpace;

    // Clamp values
    const clampedTop = Math.max(0, Math.min(newViewportTop, availableScrollSpace));
    const clampedHeight = Math.min(newViewportHeight, minimapContentHeight);

    setViewportTop(clampedTop);
    setViewportHeight(clampedHeight);
  }, [textareaRef, headerHeight]);

  // Update viewport position when content or textarea changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleScroll = () => {
      if (!isViewportDragging) {
        updateViewportFromTextarea();
      }
    };

    const handleResize = () => {
      updateViewportFromTextarea();
    };

    // Initial update
    updateViewportFromTextarea();

    // Add event listeners
    textarea.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleResize);

    return () => {
      textarea.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [updateViewportFromTextarea, isViewportDragging]);

  // Handle width resizing
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  // Handle viewport dragging
  const handleViewportDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsViewportDragging(true);
      setDragStartY(e.clientY);
      setDragStartViewportTop(viewportTop);
    },
    [viewportTop],
  );

  // Handle minimap click to jump to position
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent) => {
      if (!textareaRef.current || !minimapRef.current || isViewportDragging) return;

      const minimap = minimapRef.current;
      const rect = minimap.getBoundingClientRect();
      const clickY = e.clientY - rect.top - headerHeight;
      const minimapContentHeight = minimap.clientHeight - headerHeight;

      if (clickY < 0 || clickY > minimapContentHeight) return;

      const textarea = textareaRef.current;
      const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight);

      if (maxScroll === 0) return;

      // Calculate click ratio and apply to textarea
      const clickRatio = clickY / minimapContentHeight;
      const targetScroll = clickRatio * maxScroll;

      textarea.scrollTop = Math.max(0, Math.min(targetScroll, maxScroll));
    },
    [textareaRef, isViewportDragging, headerHeight],
  );

  // Mouse move and up handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        // Handle width resize
        const deltaX = e.movementX;
        setWidth(prev => Math.max(minWidth, Math.min(maxWidth, prev - deltaX)));
      }

      if (isViewportDragging && textareaRef.current && minimapRef.current) {
        // Handle viewport drag
        const deltaY = e.clientY - dragStartY;
        const minimapContentHeight = minimapRef.current.clientHeight - headerHeight;
        const maxViewportTop = Math.max(0, minimapContentHeight - viewportHeight);

        const newViewportTop = Math.max(0, Math.min(dragStartViewportTop + deltaY, maxViewportTop));
        setViewportTop(newViewportTop);

        // Update textarea scroll
        const textarea = textareaRef.current;
        const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight);

        if (maxScroll > 0 && maxViewportTop > 0) {
          const scrollRatio = newViewportTop / maxViewportTop;
          textarea.scrollTop = scrollRatio * maxScroll;
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsViewportDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (isDragging || isViewportDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      // Set cursor styles
      if (isDragging) {
        document.body.style.cursor = "col-resize";
      } else if (isViewportDragging) {
        document.body.style.cursor = "grabbing";
      }
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isDragging,
    isViewportDragging,
    dragStartY,
    dragStartViewportTop,
    viewportHeight,
    textareaRef,
    headerHeight,
    minWidth,
    maxWidth,
  ]);

  // Render line visualization
  const renderLines = useMemo(() => {
    // Limit the number of lines rendered for performance
    const maxLines = Math.min(lines.length, 2000);
    const linesToRender = lines.slice(0, maxLines);

    return linesToRender.map((line, index) => {
      const lineLength = line.trim().length;
      const isEmpty = lineLength === 0;

      let opacity = 0.4;
      let borderWidth = "1px";

      if (!isEmpty) {
        if (lineLength > 80) {
          opacity = 0.9;
          borderWidth = "2px";
        } else if (lineLength > 40) {
          opacity = 0.7;
          borderWidth = "1.5px";
        } else if (lineLength > 10) {
          opacity = 0.6;
          borderWidth = "1px";
        } else {
          opacity = 0.5;
          borderWidth = "1px";
        }
      }

      return (
        <div
          key={index}
          className="border-l-[1px]"
          style={{
            height: `${lineHeight}px`,
            borderLeftColor: isEmpty ? "transparent" : "var(--text-lighter)",
            borderLeftWidth: borderWidth,
            opacity: opacity,
            marginBottom: "1px",
          }}
        />
      );
    });
  }, [lines, lineHeight]);

  return (
    <div className="relative flex bg-[var(--secondary-bg)] border-l border-[var(--border-color)] h-full">
      {/* Resize handle */}
      <div
        ref={resizerRef}
        className="w-1 bg-[var(--border-color)] hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0"
        onMouseDown={handleResizeStart}
        title="Drag to resize minimap"
      />

      {/* Minimap content */}
      <div
        ref={minimapRef}
        className="relative overflow-hidden flex-shrink-0 cursor-pointer select-none"
        style={{ width: `${width}px` }}
        onClick={handleMinimapClick}
      >
        {/* Header */}
        <div className="px-2 py-1 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
          <div className="text-[9px] font-mono text-[var(--text-color)] font-medium tracking-wider">
            MINIMAP
          </div>
        </div>

        {/* Content area */}
        <div className="relative overflow-hidden h-full">
          <div ref={contentRef} className="absolute inset-0 p-1">
            {renderLines}
          </div>

          {/* Viewport indicator */}
          <div
            ref={viewportRef}
            className="absolute left-0 right-0 bg-blue-500/30 border-l-2 border-blue-400 cursor-grab active:cursor-grabbing transition-opacity duration-150 hover:bg-blue-500/40"
            style={{
              top: `${viewportTop}px`,
              height: `${viewportHeight}px`,
              marginTop: `${headerHeight}px`,
            }}
            onMouseDown={handleViewportDragStart}
            title="Drag to scroll document"
          />
        </div>
      </div>
    </div>
  );
}
