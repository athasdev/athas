import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Avatar, getAvatarInitials } from "../avatar";

describe("Avatar", () => {
  it("uses first and last initials when no image is available", () => {
    expect(getAvatarInitials("Mehmet Özgül")).toBe("MÖ");
    expect(renderToStaticMarkup(<Avatar name="Mehmet Özgül" className="size-6" />)).toContain("MÖ");
  });

  it("uses a question mark for an empty author", () => {
    expect(getAvatarInitials(" ")).toBe("?");
  });
});
