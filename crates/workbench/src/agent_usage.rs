//! What is left on the accounts the agents run on, for the Sessions sidebar's footer.
//!
//! Two accounts can answer. The Athas account reports its included credit with the plan, so it
//! costs nothing to read. GitHub answers for Copilot from `/copilot_internal/user` — see
//! `core/github/src/copilot.rs` for why that endpoint and not a documented one — which is a
//! request, so it is fetched in the background and cached.
//!
//! Claude Code and the other agents Athas launches over ACP publish no quota at all: the protocol
//! carries no usage, and a subscription's remaining session quota has no public API. They have no
//! row until one exists, rather than a row that guesses.

use agent_ui::hosted_usage::{self, Level};
use gpui::{App, Global};
use ui::{IconName, ProgressTone};
use workspace::now_ms;

/// How long Copilot's allowance is shown before it is asked for again. It moves per request, but
/// the footer is ambient — a minute of staleness is cheaper than a request per render.
const COPILOT_TTL_MS: u64 = 5 * 60 * 1000;

/// When it was last asked for, and the answer (`None` once a request came back empty).
#[derive(Default)]
struct CopilotAllowance(u64, Option<github_panel::copilot::CopilotAllowance>);

impl Global for CopilotAllowance {}

/// One account's standing, as the footer draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct UsageRow {
    pub id: &'static str,
    pub icon: IconName,
    pub label: &'static str,
    /// What is left, such as `764 left` or `$4.20 left`.
    pub value: String,
    /// The whole story, for the tooltip.
    pub detail: String,
    /// How much of the allowance is spent, 0 to 100.
    pub used_percent: f32,
    pub tone: ProgressTone,
    /// Where clicking the row goes.
    pub url: String,
}

/// The tone a share of spend reads as: the last fifth is worth noticing, nothing left is a problem.
fn tone_for(used_percent: f32) -> ProgressTone {
    if used_percent >= 100. {
        ProgressTone::Error
    } else if used_percent >= 80. {
        ProgressTone::Warning
    } else {
        ProgressTone::Accent
    }
}

/// `1500` as `1,500`, which is how an allowance reads.
fn grouped(count: i64) -> String {
    let digits = count.abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    if count < 0 { format!("-{out}") } else { out }
}

/// `2026-12-01` as `Dec 1`, the way the Athas row says its reset. The day is already the
/// account's own reset date, so it is read as written rather than shifted into local time.
fn reset_label(date: &str) -> Option<String> {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let (month, day) = date.get(..10)?.split_once('-').and_then(|(_, rest)| rest.split_once('-'))?;
    let month = MONTHS.get(month.parse::<usize>().ok()?.checked_sub(1)?)?;
    let day: u32 = day.parse().ok()?;
    (1..=31).contains(&day).then(|| format!("{month} {day}"))
}

/// Copilot's row, when the plan meters the allowance.
pub fn copilot_row(allowance: &github_panel::copilot::CopilotAllowance) -> Option<UsageRow> {
    let premium = allowance.premium.as_ref().filter(|quota| quota.is_metered())?;
    let used_percent = premium.used_fraction() * 100.;
    let mut detail = format!("{} of {} premium requests left", grouped(premium.remaining), grouped(premium.entitlement));
    if let Some(resets) = allowance.resets_on.as_deref().and_then(reset_label) {
        detail.push_str(&format!(" · resets {resets}"));
    }
    Some(UsageRow {
        id: "copilot",
        icon: IconName::BrandGithub,
        label: "Copilot",
        value: format!("{} left", grouped(premium.remaining)),
        detail,
        used_percent,
        tone: tone_for(used_percent),
        url: "https://github.com/settings/copilot".to_string(),
    })
}

/// The Athas account's row, when the plan includes credit.
pub fn athas_row(usage: &hosted_usage::HostedUsage, account_url: String) -> UsageRow {
    let used_percent = usage.used_percent as f32;
    let value = match usage.level {
        Level::Exhausted => "none left".to_string(),
        Level::IncludedExhausted => {
            let balance = usage.wallet_balance_cents.unwrap_or(0);
            format!("{} balance", hosted_usage::format_cents(balance))
        }
        _ => format!("{} left", hosted_usage::format_cents(usage.remaining_cents)),
    };
    let mut detail = format!(
        "{} of {} included credit left",
        hosted_usage::format_cents(usage.remaining_cents),
        hosted_usage::format_cents(usage.allowance_cents)
    );
    if let Some(resets) = usage.resets.as_deref() {
        detail.push_str(&format!(" · resets {resets}"));
    }
    UsageRow {
        id: "athas",
        icon: IconName::Sparkle,
        label: "Athas AI",
        value,
        detail,
        used_percent,
        tone: tone_for(used_percent),
        url: account_url,
    }
}

/// Copilot's allowance, asking GitHub for it again once the cached answer is stale. `None` until
/// the first answer arrives, and whenever GitHub has nothing to say.
fn copilot_allowance(cx: &mut App) -> Option<github_panel::copilot::CopilotAllowance> {
    let (asked_at, allowance) = {
        let cached = cx.default_global::<CopilotAllowance>();
        (cached.0, cached.1.clone())
    };
    if asked_at == 0 || now_ms().saturating_sub(asked_at) > COPILOT_TTL_MS {
        // Mark the request before spawning it, so the next render does not start another.
        cx.default_global::<CopilotAllowance>().0 = now_ms();
        // `rows` runs while the sidebar renders, so the request is started after it, as the
        // sidebar's other background reads are.
        cx.defer(move |cx| {
            let Some(fetch) = github_panel::copilot::allowance(cx) else { return };
            cx.spawn(async move |cx| {
                let fetched = fetch.await;
                cx.update(|cx| {
                    let cached = cx.default_global::<CopilotAllowance>();
                    if cached.1 != fetched {
                        cached.1 = fetched;
                        cx.refresh_windows();
                    }
                });
            })
            .detach();
        });
    }
    allowance
}

/// Sample rows the headless snapshot draws instead of live accounts, so the footer can be seen
/// without signing in.
#[derive(Default)]
struct SampleUsage(Option<Vec<UsageRow>>);

impl Global for SampleUsage {}

/// Draws `rows` in the footer in place of the real accounts.
pub fn set_sample_rows(rows: Vec<UsageRow>, cx: &mut App) {
    cx.set_global(SampleUsage(Some(rows)));
}

/// Every account with something to report, in the order the footer shows them. Empty when no
/// account is connected, which is what keeps the footer out of the way.
pub fn rows(cx: &mut App) -> Vec<UsageRow> {
    if let Some(sample) = cx.try_global::<SampleUsage>().and_then(|sample| sample.0.clone()) {
        return sample;
    }
    let mut rows = Vec::new();
    let athas = account::AccountStore::global(cx).and_then(|store| {
        let store = store.read(cx);
        store
            .is_signed_in()
            .then(|| store.subscription().and_then(|subscription| subscription.credits.as_ref()).and_then(hosted_usage::usage))
            .flatten()
    });
    if let Some(usage) = athas {
        rows.push(athas_row(&usage, account::urls(cx).billing()));
    }
    if let Some(allowance) = copilot_allowance(cx) {
        rows.extend(copilot_row(&allowance));
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use github_panel::copilot::{CopilotAllowance as Allowance, CopilotQuota};

    fn quota(remaining: i64, entitlement: i64) -> CopilotQuota {
        CopilotQuota { unlimited: false, remaining, entitlement, percent_remaining: 0. }
    }

    #[test]
    fn groups_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(764), "764");
        assert_eq!(grouped(1500), "1,500");
        assert_eq!(grouped(1234567), "1,234,567");
    }

    #[test]
    fn reads_the_reset_day() {
        assert_eq!(reset_label("2026-12-01").as_deref(), Some("Dec 1"));
        assert_eq!(reset_label("2026-12-01T00:00:00.000Z").as_deref(), Some("Dec 1"));
        assert_eq!(reset_label("whenever"), None);
    }

    #[test]
    fn copilots_row_says_what_is_left() {
        let allowance = Allowance {
            plan: Some("individual".into()),
            premium: Some(quota(764, 1500)),
            resets_on: Some("2026-12-01".into()),
        };
        let row = copilot_row(&allowance).unwrap();
        assert_eq!(row.value, "764 left");
        assert_eq!(row.detail, "764 of 1,500 premium requests left · resets Dec 1");
        assert_eq!(row.tone, ProgressTone::Accent);
        assert!((row.used_percent - 49.066).abs() < 0.01);
    }

    #[test]
    fn an_unmetered_or_spent_allowance() {
        // Unlimited and no-entitlement plans have nothing to draw.
        let unlimited = Allowance { premium: Some(CopilotQuota { unlimited: true, ..quota(0, 1500) }), ..Default::default() };
        assert_eq!(copilot_row(&unlimited), None);
        assert_eq!(copilot_row(&Allowance::default()), None);
        // The last fifth warns; nothing left reads as a problem.
        let low = Allowance { premium: Some(quota(100, 1500)), ..Default::default() };
        assert_eq!(copilot_row(&low).unwrap().tone, ProgressTone::Warning);
        let spent = Allowance { premium: Some(quota(0, 1500)), ..Default::default() };
        let spent = copilot_row(&spent).unwrap();
        assert_eq!(spent.tone, ProgressTone::Error);
        assert_eq!(spent.value, "0 left");
    }

    #[test]
    fn the_athas_row_follows_the_level() {
        let usage = hosted_usage::HostedUsage {
            used_percent: 25,
            level: Level::Ok,
            remaining_cents: 750,
            allowance_cents: 1000,
            wallet_balance_cents: None,
            resets: Some("Dec 1".into()),
        };
        let row = athas_row(&usage, "https://athas.dev/account".into());
        assert_eq!(row.value, "$7.50 left");
        assert_eq!(row.detail, "$7.50 of $10.00 included credit left · resets Dec 1");

        let spent = hosted_usage::HostedUsage { used_percent: 100, level: Level::IncludedExhausted, remaining_cents: 0, wallet_balance_cents: Some(420), ..usage.clone() };
        assert_eq!(athas_row(&spent, String::new()).value, "$4.20 balance");
        let dry = hosted_usage::HostedUsage { level: Level::Exhausted, wallet_balance_cents: None, ..spent };
        let dry = athas_row(&dry, String::new());
        assert_eq!(dry.value, "none left");
        assert_eq!(dry.tone, ProgressTone::Error);
    }
}
