import { describe, expect, it } from "vitest";
import { getDestructiveScopes } from "../services/github-credential-service";

describe("getDestructiveScopes", () => {
  it("reports nothing for a token limited to reading and writing code", () => {
    expect(getDestructiveScopes("repo, read:org, gist")).toEqual([]);
  });

  it("reports nothing for a fine-grained token, which omits the scope header", () => {
    expect(getDestructiveScopes(null)).toEqual([]);
  });

  it("flags scopes that let a token destroy or reconfigure an account", () => {
    // The shape `gh auth status` reports for a broadly scoped classic token.
    expect(getDestructiveScopes("repo, workflow, delete_repo, admin:org, gist")).toEqual([
      "delete_repo",
      "admin:org",
    ]);
  });

  it("accepts the space-separated form GitHub returns in X-OAuth-Scopes", () => {
    expect(getDestructiveScopes("repo admin:enterprise")).toEqual(["admin:enterprise"]);
  });
});
