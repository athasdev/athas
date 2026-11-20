//! Where an account stands against this period's included Athas credit and its pay-as-you-go
//! balance, as Settings > AI's Athas rows say it.
//!
//! Ported from Athas's `services/hosted-usage.ts` and `services/athas-credit.ts`.

use account::api::IntelligenceCredits;

/// `IncludedExhausted` means usage goes on from the balance; `Exhausted` means nothing is left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Ok,
    Low,
    IncludedExhausted,
    Exhausted,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HostedUsage {
    /// Settled plus in-flight usage as a share of the included credit, 0 to 100.
    pub used_percent: u32,
    pub level: Level,
    pub remaining_cents: i64,
    pub allowance_cents: i64,
    pub wallet_balance_cents: Option<i64>,
    /// When the included credit resets, as `Nov 13`.
    pub resets: Option<String>,
}

const LOW_USAGE_PERCENT: u32 = 80;
/// What current Athas plans bill hosted usage at, for servers that do not report it.
const DEFAULT_USAGE_MARKUP: f64 = 1.35;

/// `credits` read into a level, or `None` without included credit.
pub fn usage(credits: &IntelligenceCredits) -> Option<HostedUsage> {
    if credits.allowance_cents <= 0 {
        return None;
    }
    let committed = credits.used_cents.max(0) + credits.pending_cents.max(0);
    let remaining_cents = credits.remaining_cents.min(credits.allowance_cents - committed).max(0);
    let used_percent = ((committed as f64 / credits.allowance_cents as f64) * 100.).round().clamp(0., 100.) as u32;
    let wallet_balance_cents = credits.wallet_balance_cents.map(|cents| cents.max(0));
    let level = if remaining_cents <= 0 {
        if wallet_balance_cents.is_some_and(|cents| cents > 0) { Level::IncludedExhausted } else { Level::Exhausted }
    } else if used_percent >= LOW_USAGE_PERCENT {
        Level::Low
    } else {
        Level::Ok
    };
    let resets = credits
        .period_end
        .as_deref()
        .and_then(|end| chrono::DateTime::parse_from_rfc3339(end).ok())
        .map(|end| end.with_timezone(&chrono::Local).format("%b %-d").to_string());
    Some(HostedUsage {
        used_percent: if remaining_cents <= 0 { 100 } else { used_percent },
        level,
        remaining_cents,
        allowance_cents: credits.allowance_cents,
        wallet_balance_cents,
        resets,
    })
}

/// A cent amount as dollars, such as `$4.20`.
pub fn format_cents(cents: i64) -> String {
    account::gates::format_cents(cents)
}

/// The rate hosted usage is billed at, such as `list price +35%`.
pub fn usage_rate(markup: Option<f64>) -> String {
    let markup = markup.filter(|markup| markup.is_finite() && *markup >= 1.).unwrap_or(DEFAULT_USAGE_MARKUP);
    format!("list price +{}%", ((markup - 1.) * 100.).round() as i64)
}

/// A short label for where usage stands, such as `$4.20 included left` or `Using balance`.
pub fn headline(usage: &HostedUsage) -> String {
    match usage.level {
        Level::IncludedExhausted => "Using balance".into(),
        Level::Exhausted => "Out of credit".into(),
        _ => format!("{} included left", format_cents(usage.remaining_cents)),
    }
}

/// One short line about the included credit, for the Athas plan row (`describeIncludedCredit`).
pub fn describe_included_credit(usage: &HostedUsage) -> String {
    let resets = usage.resets.as_ref().map(|date| format!(" · resets {date}")).unwrap_or_default();
    match usage.level {
        Level::IncludedExhausted => format!("Included credit used, on balance{resets}"),
        Level::Exhausted if usage.wallet_balance_cents.is_none() => format!("Included credit used{resets}"),
        Level::Exhausted => format!("Included credit used, add credit to continue{resets}"),
        _ => format!("{} of {} left{resets}", format_cents(usage.remaining_cents), format_cents(usage.allowance_cents)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credits(used: i64, pending: i64, wallet: Option<i64>) -> IntelligenceCredits {
        IntelligenceCredits { allowance_cents: 1000, used_cents: used, pending_cents: pending, remaining_cents: 1000 - used, wallet_balance_cents: wallet, ..Default::default() }
    }

    #[test]
    fn levels_follow_the_included_credit_and_balance() {
        let ok = usage(&credits(200, 50, None)).unwrap();
        assert_eq!((ok.level, ok.used_percent, ok.remaining_cents), (Level::Ok, 25, 750));
        assert_eq!(describe_included_credit(&ok), "$7.50 of $10.00 left");
        assert_eq!(headline(&ok), "$7.50 included left");
        assert_eq!(usage(&credits(850, 0, None)).unwrap().level, Level::Low);
        let on_balance = usage(&credits(1000, 0, Some(420))).unwrap();
        assert_eq!((on_balance.level, on_balance.used_percent), (Level::IncludedExhausted, 100));
        assert_eq!(describe_included_credit(&on_balance), "Included credit used, on balance");
        let out = usage(&credits(1000, 0, Some(0))).unwrap();
        assert_eq!(describe_included_credit(&out), "Included credit used, add credit to continue");
        assert!(usage(&IntelligenceCredits::default()).is_none());
    }

    #[test]
    fn the_rate_falls_back_to_the_plan_default() {
        assert_eq!(usage_rate(Some(1.5)), "list price +50%");
        assert_eq!(usage_rate(None), "list price +35%");
        assert_eq!(usage_rate(Some(0.5)), "list price +35%");
    }
}
