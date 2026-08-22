import { describe, expect, it } from "vite-plus/test";
import { clampMonacoHoverWidgets } from "../engines/monaco/hover-widgets";

describe("Monaco hover widgets", () => {
  it("leaves Monaco-owned positioning intact while constraining the widget size", () => {
    const widgetStyle = {
      background: "",
      border: "",
      boxShadow: "",
      height: "",
      left: "180px",
      maxHeight: "",
      maxWidth: "",
      top: "160px",
      width: "",
    };
    const widget = {
      style: widgetStyle,
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 180, top: 160, width: 160, height: 80 }),
    } as unknown as HTMLElement;
    const container = {
      clientHeight: 180,
      clientWidth: 240,
      style: { setProperty() {} },
      querySelectorAll: () => [widget],
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLElement;

    clampMonacoHoverWidgets(container);

    expect(widgetStyle.left).toBe("180px");
    expect(widgetStyle.top).toBe("160px");
    expect(widgetStyle.maxWidth).toBe("220px");
    expect(widgetStyle.maxHeight).toBe("160px");
    expect(widgetStyle.width).toBe("120px");
  });

  it("caps long diagnostic content at the shared hover width", () => {
    const createElement = () => {
      const style = {
        background: "",
        border: "",
        boxShadow: "",
        maxHeight: "",
        maxWidth: "",
        width: "",
      };
      const element = {
        children: [],
        scrollWidth: 900,
        style,
        getBoundingClientRect: () => ({ width: 900 }),
        querySelector: () => null,
      } as unknown as HTMLElement;

      return { element, style };
    };

    const widget = createElement();
    const hover = createElement();
    const scroll = createElement();
    const content = createElement();
    widget.element.querySelector = () => hover.element;
    hover.element.querySelector = (selector: string) =>
      selector === ".monaco-scrollable-element" ? scroll.element : content.element;

    const container = {
      clientHeight: 600,
      clientWidth: 1000,
      style: { setProperty() {} },
      querySelectorAll: () => [widget.element],
    } as unknown as HTMLElement;

    clampMonacoHoverWidgets(container);

    for (const node of [widget, hover, scroll, content]) {
      expect(node.style.maxWidth).toBe("500px");
      expect(node.style.width).toBe("500px");
    }
  });
});
