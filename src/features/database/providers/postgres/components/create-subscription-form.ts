import type { CreatePostgresSubscriptionParams } from "../../../models/common.types";

export const initialCreatePostgresSubscriptionForm: CreatePostgresSubscriptionParams = {
  name: "",
  connection_string: "",
  publications: [],
  enabled: true,
  create_slot: true,
  copy_data: true,
  connect: true,
  failover: false,
  with_slot_name: "",
};

export function normalizeCreatePostgresSubscriptionParams(
  form: CreatePostgresSubscriptionParams,
): CreatePostgresSubscriptionParams {
  return {
    ...form,
    name: form.name.trim(),
    connection_string: form.connection_string.trim(),
    publications: form.publications.map((publication) => publication.trim()).filter(Boolean),
    with_slot_name: form.with_slot_name?.trim() || null,
  };
}

export function canCreatePostgresSubscription(form: CreatePostgresSubscriptionParams): boolean {
  const normalizedForm = normalizeCreatePostgresSubscriptionParams(form);
  return (
    normalizedForm.name.length > 0 &&
    normalizedForm.connection_string.length > 0 &&
    normalizedForm.publications.length > 0
  );
}
