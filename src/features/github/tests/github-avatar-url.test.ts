import { describe, expect, it } from "vite-plus/test";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";

describe("getGitHubAvatarUrl", () => {
  it("prefers the avatar URL returned by GitHub", () => {
    expect(
      getGitHubAvatarUrl({
        login: "github-actions[bot]",
        avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4",
      }),
    ).toBe("https://avatars.githubusercontent.com/in/15368?v=4");
  });

  it("does not synthesize broken profile image URLs for bot accounts", () => {
    expect(getGitHubAvatarUrl({ login: "github-actions[bot]" })).toBeUndefined();
  });

  it("uses the profile image endpoint for regular accounts", () => {
    expect(getGitHubAvatarUrl({ login: "octocat" })).toBe("https://github.com/octocat.png?size=32");
  });
});
