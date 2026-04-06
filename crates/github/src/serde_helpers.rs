use crate::models::{PullRequestAuthor, ReviewRequest, StatusCheck};
use serde::{Deserialize, Deserializer};

pub(crate) fn deserialize_string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
   D: Deserializer<'de>,
{
   Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn deserialize_author_or_default<'de, D>(
   deserializer: D,
) -> Result<PullRequestAuthor, D::Error>
where
   D: Deserializer<'de>,
{
   Ok(Option::<PullRequestAuthor>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn deserialize_bool_or_default<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
   D: Deserializer<'de>,
{
   Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn deserialize_i64_or_default<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
   D: Deserializer<'de>,
{
   Ok(Option::<i64>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn deserialize_vec_or_default<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
   D: Deserializer<'de>,
   T: Deserialize<'de>,
{
   Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn deserialize_status_checks<'de, D>(
   deserializer: D,
) -> Result<Vec<StatusCheck>, D::Error>
where
   D: Deserializer<'de>,
{
   let value = Option::<serde_json::Value>::deserialize(deserializer)?;
   let Some(value) = value else {
      return Ok(Vec::new());
   };

   let contexts = value
      .get("contexts")
      .and_then(|contexts| contexts.get("nodes"))
      .and_then(|nodes| nodes.as_array())
      .cloned()
      .unwrap_or_default();

   let mut checks = Vec::new();

   for context in contexts {
      let workflow_name = context
         .get("workflowName")
         .and_then(|value| value.as_str())
         .map(ToOwned::to_owned);

      let check = StatusCheck {
         name: context
            .get("name")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         status: context
            .get("status")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         conclusion: context
            .get("conclusion")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         workflow_name,
      };

      if check.name.is_some() || check.status.is_some() || check.conclusion.is_some() {
         checks.push(check);
      }
   }

   Ok(checks)
}

pub(crate) fn deserialize_review_requests<'de, D>(
   deserializer: D,
) -> Result<Vec<ReviewRequest>, D::Error>
where
   D: Deserializer<'de>,
{
   let values = Vec::<serde_json::Value>::deserialize(deserializer).unwrap_or_default();
   let mut review_requests = Vec::new();

   for value in values {
      let reviewer = value.get("requestedReviewer").unwrap_or(&value);
      let login = reviewer
         .get("login")
         .and_then(|value| value.as_str())
         .map(ToOwned::to_owned);

      if let Some(login) = login {
         review_requests.push(ReviewRequest {
            login,
            avatar_url: reviewer
               .get("avatarUrl")
               .and_then(|value| value.as_str())
               .map(ToOwned::to_owned),
         });
      }
   }

   Ok(review_requests)
}
