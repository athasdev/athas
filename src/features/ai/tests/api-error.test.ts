import { describe, expect, it } from "vite-plus/test";
import { getApiErrorCode, parseApiError, toChatMessageError } from "../lib/api-error";

describe("API error parsing", () => {
  it("reads structured status, code and body without regex over prose", () => {
    expect(
      parseApiError({
        status: 402,
        body: '{"error":{"code":"allowance_exhausted","message":"Allowance used"}}',
      }),
    ).toEqual({
      status: 402,
      code: "allowance_exhausted",
      body: '{"error":{"code":"allowance_exhausted","message":"Allowance used"}}',
      message: "Allowance used",
    });
  });

  it("reads SDK errors that carry statusCode and responseBody", () => {
    const error = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      responseBody: '{"code":"http_429","error":"Slow down"}',
    });
    expect(toChatMessageError(error)).toEqual({
      status: 429,
      code: "http_429",
      message: "Slow down",
      retryable: true,
    });
  });

  it("recognizes HTTP NNN and the server's error codes in legacy strings", () => {
    expect(getApiErrorCode("Request failed with HTTP 503")).toBe("503");
    expect(getApiErrorCode("athas API error: 402|||{}")).toBe("402");
    expect(getApiErrorCode("Stream ended: allowance_exhausted")).toBe("402");
    expect(getApiErrorCode("Upstream said http_429")).toBe("429");
    expect(getApiErrorCode({ code: "timeout" })).toBe("408");
    expect(getApiErrorCode("Network unavailable")).toBe("");
  });

  it("marks transient failures retryable and billing failures not", () => {
    expect(toChatMessageError({ code: "provider_rejected" }).retryable).toBe(true);
    expect(toChatMessageError({ status: 402, code: "allowance_exhausted" }).retryable).toBe(false);
    expect(toChatMessageError({ status: 401 }, "Sign in").message).toBe("Sign in");
  });
});
