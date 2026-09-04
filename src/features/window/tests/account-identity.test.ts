import { describe, expect, it } from "vite-plus/test";
import { getAccountIdentity } from "@/features/window/lib/account-identity";

describe("account identity", () => {
  it("uses the connected GitHub identity when the auth profile is unavailable", () => {
    expect(getAccountIdentity(null, "mehmetozguldev")).toEqual({
      name: "mehmetozguldev",
      detail: "@mehmetozguldev",
      githubLogin: "mehmetozguldev",
      avatarUrl: "https://github.com/mehmetozguldev.png?size=64",
    });
  });

  it("prefers the account profile image over the GitHub fallback", () => {
    expect(
      getAccountIdentity(
        {
          id: 1,
          email: "mehmet@example.com",
          name: "Mehmet",
          avatar_url: "https://example.com/profile.png",
          github_username: "mehmetozguldev",
          provider: null,
          subscription_status: "free",
          created_at: "2026-09-03T00:00:00.000Z",
        },
        "mehmetozguldev",
      ),
    ).toMatchObject({
      name: "Mehmet",
      avatarUrl: "https://example.com/profile.png",
    });
  });
});
