import { describe, expect, it } from "vite-plus/test";
import {
  formatDatabaseError,
  normalizeDatabaseError,
} from "@/features/database/lib/database-errors";

describe("database error formatting", () => {
  it("normalizes DuckDB sidecar panic output", () => {
    const message =
      "thread 'main' (11930243) panicked at /Users/mehmet/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/duckdb-1.10502.0/src/raw_statement.rs:86:21: The statement was not executed yet note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace";

    expect(normalizeDatabaseError(message)).toBe(
      "The database provider failed while reading the query result. Please retry the query or reopen the database.",
    );
  });

  it("normalizes typed sidecar panic envelopes", () => {
    expect(normalizeDatabaseError("Database sidecar panic: simulated provider panic")).toBe(
      "The database provider crashed while handling this request: simulated provider panic",
    );
  });

  it("normalizes sidecar protocol and response envelope errors", () => {
    expect(normalizeDatabaseError("Unsupported database sidecar protocol version: 2")).toBe(
      "The database provider version is not compatible with this Athas build. Please update or reinstall the database extension.",
    );
    expect(
      normalizeDatabaseError(
        "Unsupported database sidecar protocol version for provider postgres: 2",
      ),
    ).toBe(
      "The database provider version is not compatible with this Athas build. Please update or reinstall the database extension.",
    );
    expect(normalizeDatabaseError("Invalid database sidecar envelope: missing field `ok`")).toBe(
      "The database provider returned an invalid response. Please update or reinstall the database extension.",
    );
    expect(normalizeDatabaseError("Database sidecar response was missing protocolVersion")).toBe(
      "The database provider returned an incomplete response. Please update or reinstall the database extension.",
    );
    expect(normalizeDatabaseError("Database sidecar response was missing result")).toBe(
      "The database provider returned an incomplete response. Please update or reinstall the database extension.",
    );
    expect(normalizeDatabaseError("Database sidecar returned an unknown error")).toBe(
      "The database provider returned an incomplete error response. Please update or reinstall the database extension.",
    );
  });

  it("normalizes sidecar timeout errors", () => {
    expect(normalizeDatabaseError("Database sidecar timed out after 30 seconds")).toBe(
      "The database provider timed out while handling this request. Please retry or narrow the query.",
    );
  });

  it("treats empty error message payloads as unknown errors", () => {
    expect(normalizeDatabaseError({ message: undefined })).toBe("Unknown database error");
    expect(normalizeDatabaseError({ message: null })).toBe("Unknown database error");
  });

  it("keeps normal provider errors readable", () => {
    expect(formatDatabaseError("Query failed", new Error("relation users does not exist"))).toBe(
      "Query failed: relation users does not exist",
    );
  });
});
