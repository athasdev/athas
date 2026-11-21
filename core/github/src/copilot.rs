//! The signed-in account's Copilot allowance.
//!
//! GitHub publishes no REST endpoint for a person's own Copilot quota — the documented
//! `/orgs/{org}/copilot/*` routes report an organization's seats and metrics, not what is left
//! this month. `/copilot_internal/user` is the endpoint the official editor plugins read, and it
//! answers for whichever account the token belongs to. It is not in the REST reference, so treat
//! a changed shape as "unknown" rather than an error: every field is optional and a failed read
//! leaves the footer empty.

use serde::Deserialize;

/// One of the allowances `quota_snapshots` reports.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct CopilotQuota {
   /// Whether the plan meters this allowance at all.
   pub unlimited: bool,
   /// How much of the monthly entitlement is left.
   pub remaining: i64,
   /// The monthly entitlement; zero when the plan does not grant one.
   pub entitlement: i64,
   pub percent_remaining: f64,
}

impl CopilotQuota {
   /// Whether this allowance is worth showing: metered, and with an entitlement to measure against.
   pub fn is_metered(&self) -> bool {
      !self.unlimited && self.entitlement > 0
   }

   /// How much of the entitlement is spent, 0.0 to 1.0.
   pub fn used_fraction(&self) -> f32 {
      if self.entitlement <= 0 {
         return 0.;
      }
      let used = (self.entitlement - self.remaining).max(0) as f32;
      (used / self.entitlement as f32).clamp(0., 1.)
   }
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
struct QuotaSnapshots {
   /// Agent and chat turns on the paid models — the allowance that actually runs out.
   premium_interactions: Option<CopilotQuota>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
struct CopilotUser {
   /// `individual`, `business`, `enterprise`, or absent without Copilot.
   copilot_plan: Option<String>,
   quota_snapshots: Option<QuotaSnapshots>,
   /// The day the allowance refills, as `YYYY-MM-DD`.
   quota_reset_date: Option<String>,
}

/// What the footer shows for Copilot.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CopilotAllowance {
   pub plan: Option<String>,
   pub premium: Option<CopilotQuota>,
   pub resets_on: Option<String>,
}

impl CopilotAllowance {
   /// Whether there is a metered allowance to draw.
   pub fn has_quota(&self) -> bool {
      self.premium.as_ref().is_some_and(CopilotQuota::is_metered)
   }
}

pub(crate) fn parse_allowance(body: &str) -> Result<CopilotAllowance, String> {
   let user: CopilotUser =
      serde_json::from_str(body).map_err(|error| format!("Failed to parse the Copilot allowance: {error}"))?;
   Ok(CopilotAllowance {
      plan: user.copilot_plan.filter(|plan| !plan.trim().is_empty()),
      premium: user.quota_snapshots.and_then(|snapshots| snapshots.premium_interactions),
      resets_on: user.quota_reset_date.filter(|date| !date.trim().is_empty()),
   })
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn reads_the_metered_allowance() {
      let allowance = parse_allowance(
         r#"{
            "copilot_plan": "individual",
            "quota_reset_date": "2026-12-01",
            "quota_snapshots": {
               "chat": {"unlimited": true, "remaining": 0, "entitlement": 0, "percent_remaining": 100.0},
               "premium_interactions": {"unlimited": false, "remaining": 764, "entitlement": 1500, "percent_remaining": 50.9}
            }
         }"#,
      )
      .unwrap();
      assert_eq!(allowance.plan.as_deref(), Some("individual"));
      assert_eq!(allowance.resets_on.as_deref(), Some("2026-12-01"));
      assert!(allowance.has_quota());
      let premium = allowance.premium.unwrap();
      assert_eq!(premium.remaining, 764);
      assert!((premium.used_fraction() - 736. / 1500.).abs() < 0.001);
   }

   #[test]
   fn an_unlimited_or_absent_allowance_has_nothing_to_show() {
      let unlimited = parse_allowance(r#"{"quota_snapshots": {"premium_interactions": {"unlimited": true}}}"#).unwrap();
      assert!(!unlimited.has_quota());
      // A plan without Copilot, and an answer whose shape moved on, both read as "nothing".
      assert!(!parse_allowance("{}").unwrap().has_quota());
      assert!(!parse_allowance(r#"{"quota_snapshots": {}}"#).unwrap().has_quota());
      assert!(parse_allowance("not json").is_err());
   }
}
