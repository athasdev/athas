import { describe, expect, it } from "vite-plus/test";
import {
  canCreatePostgresSubscription,
  initialCreatePostgresSubscriptionForm,
  normalizeCreatePostgresSubscriptionParams,
} from "./create-subscription-form";

describe("create postgres subscription form", () => {
  it("provides the default subscription options", () => {
    expect(initialCreatePostgresSubscriptionForm).toEqual({
      name: "",
      connection_string: "",
      publications: [],
      enabled: true,
      create_slot: true,
      copy_data: true,
      connect: true,
      failover: false,
      with_slot_name: "",
    });
  });

  it("trims submitted subscription text fields", () => {
    expect(
      normalizeCreatePostgresSubscriptionParams({
        ...initialCreatePostgresSubscriptionForm,
        name: " analytics_sub ",
        connection_string: " host=127.0.0.1 dbname=postgres ",
        publications: [" pub_one ", "", " pub_two "],
        with_slot_name: " analytics_slot ",
      }),
    ).toEqual({
      ...initialCreatePostgresSubscriptionForm,
      name: "analytics_sub",
      connection_string: "host=127.0.0.1 dbname=postgres",
      publications: ["pub_one", "pub_two"],
      with_slot_name: "analytics_slot",
    });
  });

  it("normalizes blank slot names to null", () => {
    expect(
      normalizeCreatePostgresSubscriptionParams({
        ...initialCreatePostgresSubscriptionForm,
        with_slot_name: "   ",
      }).with_slot_name,
    ).toBeNull();
  });

  it("requires normalized name, connection string, and publications before submit", () => {
    expect(
      canCreatePostgresSubscription({
        ...initialCreatePostgresSubscriptionForm,
        name: " analytics_sub ",
        connection_string: " host=127.0.0.1 ",
        publications: [" pub_one "],
      }),
    ).toBe(true);

    expect(
      canCreatePostgresSubscription({
        ...initialCreatePostgresSubscriptionForm,
        name: " analytics_sub ",
        connection_string: " host=127.0.0.1 ",
        publications: ["   "],
      }),
    ).toBe(false);
  });
});
