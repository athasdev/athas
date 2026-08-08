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
});
