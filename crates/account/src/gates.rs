//! What the plan unlocks and how the account reads in the UI (`product-capabilities.ts`,
//! `use-pro-feature.ts`, `account-usage.ts`, `account-identity.ts`).

use crate::api::{AuthUser, IntelligenceCredits, SubscriptionInfo};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Capability {
    Intelligence,
    HostedAi,
    SettingsSync,
    CloudWorkspaces,
    CloudAgents,
    Previews,
    Collaboration,
    EnterprisePolicy,
}

pub fn has_capability(subscription: Option<&SubscriptionInfo>, capability: Capability) -> bool {
    let Some(subscription) = subscription else { return false };
    let capabilities = &subscription.capabilities;
    match capability {
        Capability::Intelligence => capabilities.intelligence,
        Capability::HostedAi => capabilities.hosted_ai,
        Capability::SettingsSync => capabilities.settings_sync,
        Capability::CloudWorkspaces => capabilities.cloud_workspaces,
        Capability::CloudAgents => capabilities.cloud_agents,
        Capability::Previews => capabilities.previews,
        Capability::Collaboration => capabilities.collaboration,
        Capability::EnterprisePolicy => capabilities.enterprise_policy,
    }
}

/// Which paid features the account may use right now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProFeatures {
    pub is_pro: bool,
    pub intelligence: bool,
    pub settings_sync: bool,
    pub cloud_workspaces: bool,
    pub cloud_agents: bool,
    pub previews: bool,
    pub collaboration: bool,
}

impl ProFeatures {
    /// Before the plan loads, a user record that says Pro unlocks the Pro features.
    pub fn resolve(user: Option<&AuthUser>, subscription: Option<&SubscriptionInfo>) -> Self {
        let pro_snapshot = subscription.is_none() && user.is_some_and(AuthUser::is_pro_snapshot);
        let intelligence = pro_snapshot || has_capability(subscription, Capability::Intelligence);
        let settings_sync = pro_snapshot || has_capability(subscription, Capability::SettingsSync);
        Self {
            is_pro: user.is_some_and(AuthUser::is_pro_snapshot) || intelligence || settings_sync,
            intelligence,
            settings_sync,
            cloud_workspaces: pro_snapshot || has_capability(subscription, Capability::CloudWorkspaces),
            cloud_agents: has_capability(subscription, Capability::CloudAgents),
            previews: has_capability(subscription, Capability::Previews),
            collaboration: has_capability(subscription, Capability::Collaboration),
        }
    }

    pub fn allows(&self, capability: Capability) -> bool {
        match capability {
            Capability::Intelligence | Capability::HostedAi => self.intelligence,
            Capability::SettingsSync => self.settings_sync,
            Capability::CloudWorkspaces => self.cloud_workspaces,
            Capability::CloudAgents => self.cloud_agents,
            Capability::Previews => self.previews,
            Capability::Collaboration => self.collaboration,
            Capability::EnterprisePolicy => false,
        }
    }
}

/// `Enterprise`, `Teams`, `Plus`, `Pro`, `Free`, or `Guest` while signed out.
pub fn plan_label(subscription: Option<&SubscriptionInfo>, signed_in: bool) -> &'static str {
    match subscription.and_then(SubscriptionInfo::plan) {
        Some("enterprise") => "Enterprise",
        Some("teams") => "Teams",
        Some("plus") => "Plus",
        _ if has_capability(subscription, Capability::Intelligence) => "Pro",
        _ if signed_in => "Free",
        _ => "Guest",
    }
}

/// Whether the plan is a paid one: Pro, a team or enterprise.
pub fn is_paid(features: &ProFeatures, subscription: Option<&SubscriptionInfo>) -> bool {
    features.is_pro || subscription.and_then(SubscriptionInfo::plan) == Some("enterprise") || subscription.and_then(SubscriptionInfo::team).is_some()
}

pub fn format_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let cents = cents.unsigned_abs();
    format!("{sign}${}.{:02}", cents / 100, cents % 100)
}

/// This period's included AI credit, as the account menu's bar shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct CreditUsage {
    /// How much of the included credit is used, pending charges included: 0 to 1.
    pub fraction: f32,
    pub label: String,
    pub detail: Option<String>,
}

impl CreditUsage {
    pub fn from_credits(credits: &IntelligenceCredits) -> Option<Self> {
        if credits.allowance_cents <= 0 && credits.wallet_balance_cents.is_none() {
            return None;
        }
        let used = credits.used_cents + credits.pending_cents;
        let fraction = if credits.allowance_cents > 0 { (used as f32 / credits.allowance_cents as f32).clamp(0., 1.) } else { 1. };
        let label = if credits.allowance_cents > 0 {
            format!("{} of {} used", format_cents(used), format_cents(credits.allowance_cents))
        } else {
            "No included credit".to_string()
        };
        let detail = credits.wallet_balance_cents.map(|balance| format!("{} prepaid balance", format_cents(balance)));
        Some(Self { fraction, label, detail })
    }
}

/// The name and second line the account shows under.
pub fn identity(user: Option<&AuthUser>) -> (String, Option<String>) {
    let github = user.and_then(|user| user.github_username.clone()).filter(|login| !login.is_empty());
    let name = user
        .and_then(|user| user.name.clone().filter(|name| !name.is_empty()))
        .or_else(|| github.clone())
        .or_else(|| user.map(|user| user.email.clone()).filter(|email| !email.is_empty()))
        .unwrap_or_else(|| "Account".to_string());
    let detail = github.map(|login| format!("@{login}")).or_else(|| user.map(|user| user.email.clone()).filter(|email| !email.is_empty()));
    (name, detail)
}

/// The account's picture (`getAccountIdentity`): its own `avatar_url`, else the linked GitHub
/// account's at 64px.
pub fn avatar_url(user: Option<&AuthUser>) -> Option<String> {
    let user = user?;
    if let Some(url) = user.avatar_url.as_deref().map(str::trim).filter(|url| !url.is_empty()) {
        return Some(url.to_string());
    }
    let login = user.github_username.as_deref().map(str::trim).filter(|login| !login.is_empty())?;
    Some(ui::avatar::github_avatar_url(login))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn avatar_prefers_the_accounts_own_picture() {
        let mut user = AuthUser { email: "sam@example.com".into(), github_username: Some("sam".into()), ..Default::default() };
        assert_eq!(avatar_url(Some(&user)).as_deref(), Some("https://github.com/sam.png?size=64"));
        user.avatar_url = Some(" https://cdn.example/sam.png ".into());
        assert_eq!(avatar_url(Some(&user)).as_deref(), Some("https://cdn.example/sam.png"));
        user.avatar_url = None;
        user.github_username = None;
        assert_eq!(avatar_url(Some(&user)), None);
        assert_eq!(avatar_url(None), None);
    }

    fn subscription(value: serde_json::Value) -> SubscriptionInfo {
        SubscriptionInfo::parse(&value).unwrap()
    }

    #[test]
    fn plan_labels() {
        assert_eq!(plan_label(None, false), "Guest");
        assert_eq!(plan_label(None, true), "Free");
        assert_eq!(plan_label(Some(&subscription(json!({ "status": "pro" }))), true), "Pro");
        assert_eq!(plan_label(Some(&subscription(json!({ "status": "pro", "subscription": { "plan": "teams" } }))), true), "Teams");
        assert_eq!(plan_label(Some(&subscription(json!({ "status": "free", "subscription": { "plan": "enterprise" } }))), true), "Enterprise");
    }

    #[test]
    fn a_pro_user_record_unlocks_pro_until_the_plan_loads() {
        let user = AuthUser { subscription_status: Some("pro".into()), ..Default::default() };
        let early = ProFeatures::resolve(Some(&user), None);
        assert!(early.is_pro && early.intelligence && early.settings_sync && !early.cloud_agents);
        let free = subscription(json!({ "status": "free" }));
        let loaded = ProFeatures::resolve(Some(&user), Some(&free));
        assert!(!loaded.intelligence && !loaded.allows(Capability::SettingsSync));
        assert!(!ProFeatures::resolve(None, None).is_pro);
    }

    #[test]
    fn credit_usage() {
        let credits = IntelligenceCredits { allowance_cents: 2000, used_cents: 450, pending_cents: 50, wallet_balance_cents: Some(1234), ..Default::default() };
        let usage = CreditUsage::from_credits(&credits).unwrap();
        assert_eq!(usage.fraction, 0.25);
        assert_eq!(usage.label, "$5.00 of $20.00 used");
        assert_eq!(usage.detail.as_deref(), Some("$12.34 prepaid balance"));
        assert_eq!(CreditUsage::from_credits(&IntelligenceCredits::default()), None);
        assert_eq!(format_cents(-5), "-$0.05");
    }

    #[test]
    fn identity_prefers_the_name_then_github_then_email() {
        let user = AuthUser { email: "sam@example.com".into(), github_username: Some("sam".into()), ..Default::default() };
        assert_eq!(identity(Some(&user)), ("sam".into(), Some("@sam".into())));
        let named = AuthUser { name: Some("Sam Lee".into()), email: "sam@example.com".into(), ..Default::default() };
        assert_eq!(identity(Some(&named)), ("Sam Lee".into(), Some("sam@example.com".into())));
        assert_eq!(identity(None), ("Account".into(), None));
    }
}
