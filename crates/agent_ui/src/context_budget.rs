//! How much a request carries, against the model's context window: a provider-independent token
//! estimate, long text cut to its head and tail, attachments fitted into one message's budget,
//! and the composer meter's breakdown.
//!
//! Ported from Athas's `lib/context-budget.ts` and `lib/composer-context-budget.ts`.

/// Rough characters per token for source code and English prose.
const CHARS_PER_TOKEN: usize = 4;
/// Tokens kept free for the answer when the model does not report its output limit.
pub const DEFAULT_RESERVED_OUTPUT_TOKENS: usize = 4_096;
/// Context use at or above this share of the limit is shown as a warning.
const WARNING_RATIO: f64 = 0.8;
/// Context use at or above this share of the limit is shown as an error.
const ERROR_RATIO: f64 = 0.95;
/// Below this share, instructions alone are not worth a meter.
const QUIET_RATIO: f64 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttachmentBudget {
    pub per_attachment_tokens: usize,
    pub total_tokens: usize,
}

pub const DEFAULT_ATTACHMENT_BUDGET: AttachmentBudget = AttachmentBudget { per_attachment_tokens: 8_000, total_tokens: 32_000 };

/// A fast token estimate. It errs slightly high for code, which keeps budgets conservative; it is
/// not a tokenizer.
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(CHARS_PER_TOKEN)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Truncated {
    pub text: String,
    pub truncated: bool,
    pub original_tokens: usize,
}

fn marker(shown: usize, original: usize) -> String {
    format!("... [truncated: showing about {shown} of {original} tokens] ...")
}

/// Cuts `text` to about `max_tokens`, keeping the start and the end, which usually carry the
/// imports, the declarations and the most recent output. Cuts fall on line breaks when possible.
pub fn truncate_text_to_tokens(text: &str, max_tokens: usize) -> Truncated {
    let original_tokens = estimate_tokens(text);
    if original_tokens <= max_tokens {
        return Truncated { text: text.to_string(), truncated: false, original_tokens };
    }
    let max_chars = max_tokens * CHARS_PER_TOKEN;
    let placeholder = marker(max_tokens, original_tokens);
    let marker_chars = placeholder.chars().count();
    if max_chars < marker_chars + 2 {
        return Truncated { text: "[truncated]".chars().take(max_chars).collect(), truncated: true, original_tokens };
    }
    let chars: Vec<char> = text.chars().collect();
    let content_chars = max_chars - marker_chars - 2;
    let head_chars = content_chars * 4 / 5;
    let tail_chars = content_chars - head_chars;
    let mut head: String = chars[..head_chars].iter().collect();
    if let Some(at) = head.rfind('\n')
        && head[..at].chars().count() > head_chars / 2
    {
        head.truncate(at);
    }
    let mut tail: String = chars[chars.len() - tail_chars..].iter().collect();
    if let Some(at) = tail.find('\n')
        && tail[..at].chars().count() < tail_chars / 2
    {
        tail = tail[at + 1..].to_string();
    }
    let fitted = marker(estimate_tokens(&head) + estimate_tokens(&tail), original_tokens);
    Truncated { text: format!("{head}\n{fitted}\n{tail}"), truncated: true, original_tokens }
}

/// One attachment's content as fitted into a message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fitted {
    pub content: String,
    pub truncated: bool,
    pub original_tokens: usize,
}

/// Fits attachments into one message's budget. Each is cut to the per-attachment cap, and once
/// the total is spent their content is left out. Returns the fitted contents, the tokens used and
/// whether anything was cut.
pub fn apply_attachment_budget<'a>(contents: impl IntoIterator<Item = &'a str>, budget: AttachmentBudget) -> (Vec<Fitted>, usize, bool) {
    let mut remaining = budget.total_tokens;
    let mut used = 0;
    let mut any = false;
    let fitted = contents
        .into_iter()
        .map(|content| {
            let allowance = budget.per_attachment_tokens.min(remaining);
            let original_tokens = estimate_tokens(content);
            if allowance == 0 {
                any = true;
                return Fitted { content: String::new(), truncated: true, original_tokens };
            }
            let result = truncate_text_to_tokens(content, allowance);
            let tokens = estimate_tokens(&result.text);
            remaining = remaining.saturating_sub(tokens);
            used += tokens;
            any |= result.truncated;
            Fitted { content: result.text, truncated: result.truncated, original_tokens }
        })
        .collect();
    (fitted, used, any)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    System,
    Rules,
    History,
    Attachment,
    Context,
    Message,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetItem {
    pub kind: ItemKind,
    pub label: String,
    pub tokens: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ContextBudget {
    pub items: Vec<BudgetItem>,
    pub used_tokens: usize,
    pub limit_tokens: Option<usize>,
    pub ratio: Option<f64>,
    pub over_limit: bool,
    pub truncated: bool,
}

/// What a request would send, measured against the model's context window.
#[derive(Default)]
pub struct BudgetInput<'a> {
    pub context_window_tokens: Option<usize>,
    pub reserved_output_tokens: Option<usize>,
    pub system_prompt: &'a str,
    pub rules: &'a str,
    pub rules_truncated: bool,
    pub history: Vec<&'a str>,
    /// Attached files: name, content, whether it was cut.
    pub attachments: Vec<(&'a str, &'a str, bool)>,
    /// Context references: label, content, whether it was cut.
    pub references: Vec<(&'a str, &'a str, bool)>,
    pub message: &'a str,
}

pub fn build_context_budget(input: BudgetInput) -> ContextBudget {
    let mut items = Vec::new();
    let mut add = |kind, label: &str, tokens: usize, truncated: bool| {
        if tokens > 0 {
            items.push(BudgetItem { kind, label: label.to_string(), tokens, truncated });
        }
    };
    add(ItemKind::System, "System prompt", estimate_tokens(input.system_prompt), false);
    add(ItemKind::Rules, "Project rules", estimate_tokens(input.rules), input.rules_truncated);
    add(ItemKind::History, "Conversation", input.history.iter().map(|text| estimate_tokens(text)).sum(), false);
    for (name, content, truncated) in &input.attachments {
        add(ItemKind::Attachment, name, estimate_tokens(content), *truncated);
    }
    for (label, content, truncated) in &input.references {
        add(ItemKind::Context, label, estimate_tokens(content), *truncated);
    }
    add(ItemKind::Message, "Message", estimate_tokens(input.message), false);
    let used_tokens = items.iter().map(|item| item.tokens).sum();
    let limit_tokens = input.context_window_tokens.map(|window| window.saturating_sub(input.reserved_output_tokens.unwrap_or(DEFAULT_RESERVED_OUTPUT_TOKENS)));
    let ratio = limit_tokens.filter(|limit| *limit > 0).map(|limit| (used_tokens as f64 / limit as f64).min(1.));
    let truncated = items.iter().any(|item| item.truncated);
    ContextBudget { items, used_tokens, limit_tokens, ratio, over_limit: limit_tokens.is_some_and(|limit| used_tokens > limit), truncated }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Accent,
    Warning,
    Error,
}

impl ContextBudget {
    /// Whether the meter has anything to say: a new chat carries only the agent's instructions,
    /// so it waits for conversation, attachments or references, or a budget already half used.
    pub fn worth_showing(&self) -> bool {
        if self.used_tokens == 0 {
            return false;
        }
        if self.over_limit || self.ratio.unwrap_or(0.) >= QUIET_RATIO {
            return true;
        }
        self.items.iter().any(|item| item.tokens > 0 && matches!(item.kind, ItemKind::History | ItemKind::Attachment | ItemKind::Context))
    }

    pub fn tone(&self) -> Tone {
        let ratio = self.ratio.unwrap_or(0.);
        if self.over_limit || ratio >= ERROR_RATIO {
            Tone::Error
        } else if ratio >= WARNING_RATIO {
            Tone::Warning
        } else {
            Tone::Accent
        }
    }

    /// "42% of 128k context (54k tokens)", or the tokens alone without a known window.
    pub fn describe(&self) -> String {
        let used = format!("{} tokens", format_tokens(self.used_tokens));
        match self.limit_tokens {
            None => format!("{used} of context"),
            Some(limit) => format!("{}% of {} context ({used})", (self.ratio.unwrap_or(0.) * 100.).round() as u64, format_tokens(limit)),
        }
    }

    /// The breakdown: files, rules, conversation, references and instructions, largest first,
    /// each with its count and whether any of it was cut.
    pub fn groups(&self) -> Vec<(&'static str, usize, usize, bool)> {
        let mut groups: Vec<(&'static str, usize, usize, bool)> = Vec::new();
        for item in &self.items {
            let label = match item.kind {
                ItemKind::Attachment => "Files",
                ItemKind::Rules => "Rules",
                ItemKind::History => "Conversation",
                ItemKind::Context => "References",
                ItemKind::System | ItemKind::Message => "Instructions",
            };
            match groups.iter_mut().find(|group| group.0 == label) {
                Some(group) => {
                    group.1 += item.tokens;
                    group.2 += 1;
                    group.3 |= item.truncated;
                }
                None => groups.push((label, item.tokens, 1, item.truncated)),
            }
        }
        groups.sort_by(|a, b| b.1.cmp(&a.1));
        groups
    }

    /// The meter's closing line when the window is nearly full.
    pub fn advice(&self) -> Option<&'static str> {
        match self.tone() {
            Tone::Accent => None,
            _ if self.over_limit => Some("Over the limit: older messages will be summarised and large files cut."),
            _ => Some("Nearly full: run /compact or start a new chat to keep answers sharp."),
        }
    }
}

/// `950`, `1.2k`, `12k`, `1M` in the user's locale (`formatTokenCount`).
pub fn format_tokens(tokens: usize) -> String {
    crate::summary::format_token_count(tokens as u64)
}

/// Share of the context window in use, from 0 to 100 (`getContextUsagePercent`).
pub fn usage_percent(used: u64, size: u64) -> f64 {
    if size == 0 {
        return 0.;
    }
    (used as f64 / size as f64 * 100.).clamp(0., 100.)
}

/// The session's cost in its own currency, in the user's locale; under a cent keeps four digits
/// so it does not read as free (`formatUsageCost`). macOS formats it as `Intl.NumberFormat` does
/// in the webview, with the system locale; elsewhere it is formatted as en-US.
pub fn format_usage_cost(amount: f64, currency: &str) -> String {
    let max_digits = cost_fraction_digits(amount);
    if let Some(formatted) = crate::locale_format::currency(amount, currency, max_digits) {
        return formatted;
    }
    format_usage_cost_en_us(amount, currency)
}

fn cost_fraction_digits(amount: f64) -> usize {
    if amount > 0. && amount < 0.01 { 4 } else { 2 }
}

/// [`format_usage_cost`] as `Intl.NumberFormat("en-US", { style: "currency" })` writes it: any
/// ISO 4217 code is a currency (the symbol where en-US has one, else the code), anything else
/// is shown after the amount as the agent sent it.
pub fn format_usage_cost_en_us(amount: f64, currency: &str) -> String {
    let number = group_en_us(amount.abs(), cost_fraction_digits(amount));
    let sign = if amount < 0. && number.chars().any(|ch| ch.is_ascii_digit() && ch != '0') { "-" } else { "" };
    if currency.len() == 3 && currency.chars().all(|ch| ch.is_ascii_alphabetic()) {
        let code = currency.to_ascii_uppercase();
        return match en_us_currency_symbol(&code) {
            Some(symbol) => format!("{sign}{symbol}{number}"),
            None => format!("{sign}{code}\u{a0}{number}"),
        };
    }
    let number = format!("{sign}{number}");
    if currency.is_empty() { number } else { format!("{number} {currency}") }
}

/// The amount with two to `max_digits` fraction digits and thousands grouped, as en-US does.
fn group_en_us(amount: f64, max_digits: usize) -> String {
    let mut fixed = format!("{amount:.max_digits$}");
    if let Some(dot) = fixed.find('.') {
        while fixed.len() > dot + 3 && fixed.ends_with('0') {
            fixed.pop();
        }
    }
    let (whole, fraction) = fixed.split_once('.').unwrap_or((&fixed, ""));
    let mut grouped = String::new();
    for (index, ch) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    if fraction.is_empty() { grouped } else { format!("{grouped}.{fraction}") }
}

/// The symbols en-US gives currencies (CLDR); every other code is written as the code.
fn en_us_currency_symbol(code: &str) -> Option<&'static str> {
    Some(match code {
        "USD" => "$",
        "EUR" => "€",
        "GBP" => "£",
        "JPY" => "¥",
        "CNY" => "CN¥",
        "INR" => "₹",
        "KRW" => "₩",
        "ILS" => "₪",
        "VND" => "₫",
        "PHP" => "₱",
        "CAD" => "CA$",
        "AUD" => "A$",
        "NZD" => "NZ$",
        "HKD" => "HK$",
        "MXN" => "MX$",
        "BRL" => "R$",
        "TWD" => "NT$",
        "XCD" => "EC$",
        "XAF" => "FCFA",
        "XOF" => "F\u{202f}CFA",
        "XPF" => "CFPF",
        _ => return None,
    })
}

/// "42% of 200k context (84k tokens used) · $0.12 spent" (`describeContextUsage`).
pub fn describe_context_usage(used: u64, size: u64, cost: Option<&str>) -> String {
    let percent = usage_percent(used, size).round() as u64;
    let spent = cost.map(|cost| format!(" · {cost} spent")).unwrap_or_default();
    format!("{percent}% of {} context ({} tokens used){spent}", format_tokens(size as usize), format_tokens(used as usize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_an_agents_context_use_and_cost() {
        assert_eq!(describe_context_usage(84_000, 200_000, Some("$0.12")), "42% of 200k context (84k tokens used) · $0.12 spent");
        assert_eq!(format_usage_cost_en_us(0.004, "USD"), "$0.004");
        assert_eq!(format_usage_cost_en_us(0.00412, "USD"), "$0.0041");
        assert_eq!(format_usage_cost_en_us(1.5, "usd"), "$1.50");
        assert_eq!(format_usage_cost_en_us(1234.5, "EUR"), "€1,234.50");
        assert_eq!(format_usage_cost_en_us(1_234_567.0, "INR"), "₹1,234,567.00");
        assert_eq!(format_usage_cost_en_us(2.0, "CHF"), "CHF\u{a0}2.00");
        assert_eq!(format_usage_cost_en_us(2.0, "cad"), "CA$2.00");
        assert_eq!(format_usage_cost_en_us(2.0, "credits"), "2.00 credits");
        assert_eq!(format_usage_cost_en_us(2.0, ""), "2.00");
        // Whatever the locale, the amount and its currency are both there.
        let local = format_usage_cost(1.5, "USD");
        assert!(local.contains('1') && local.contains('5') && (local.contains('$') || local.contains("USD")), "{local}");
        assert_eq!(usage_percent(5, 0), 0.);
        assert_eq!(usage_percent(300, 200), 100.);
    }

    fn lines(count: usize) -> String {
        (0..count).map(|index| format!("line {index} {}", "x".repeat(30))).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn estimates_tokens_from_text_length() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn keeps_the_head_and_tail_of_long_text() {
        let text = lines(400);
        let result = truncate_text_to_tokens(&text, 500);
        assert!(result.truncated);
        assert_eq!(result.original_tokens, estimate_tokens(&text));
        assert!(result.text.starts_with("line 0 "));
        assert!(result.text.ends_with(&format!("line 399 {}", "x".repeat(30))));
        assert!(result.text.contains("[truncated: showing about "));
        assert!(estimate_tokens(&result.text) <= 500);
        for limit in [0, 1, 2, 10, 20, 100] {
            let result = truncate_text_to_tokens(&lines(400), limit);
            assert!(estimate_tokens(&result.text) <= limit);
            assert!(result.truncated);
        }
        assert_eq!(truncate_text_to_tokens("short", 10), Truncated { text: "short".into(), truncated: false, original_tokens: 2 });
    }

    #[test]
    fn caps_attachments_then_leaves_them_out() {
        let (big, second, third) = ("x".repeat(16000), "x".repeat(16000), "s".repeat(8000));
        let (fitted, used, truncated) = apply_attachment_budget([big.as_str(), second.as_str(), third.as_str()], AttachmentBudget { per_attachment_tokens: 1_000, total_tokens: 1_500 });
        assert!(truncated);
        assert!(estimate_tokens(&fitted[0].content) <= 1_000);
        assert!(fitted[0].truncated);
        assert!(estimate_tokens(&fitted[1].content) <= 500);
        assert!(fitted[2].truncated && fitted[2].content.is_empty());
        assert!(used <= 1_500);
        let (fitted, used, truncated) = apply_attachment_budget(["Some text"], AttachmentBudget { per_attachment_tokens: 100, total_tokens: 0 });
        assert_eq!((used, truncated, fitted[0].content.as_str()), (0, true, ""));
    }

    #[test]
    fn measures_a_request_against_the_window() {
        let budget = build_context_budget(BudgetInput {
            context_window_tokens: Some(14_096),
            history: vec!["a".repeat(32_000).leak()],
            attachments: vec![("a.rs", "b".repeat(4_000).leak(), true)],
            message: "Fix it",
            ..Default::default()
        });
        assert_eq!(budget.limit_tokens, Some(10_000));
        assert_eq!(budget.used_tokens, 8_000 + 1_000 + 2);
        assert_eq!(budget.tone(), Tone::Warning);
        assert!(budget.worth_showing() && budget.truncated);
        assert_eq!(budget.groups()[0], ("Conversation", 8_000, 1, false));
        assert_eq!(budget.describe(), "90% of 10k context (9k tokens)");
        assert!(!build_context_budget(BudgetInput { system_prompt: "You are", ..Default::default() }).worth_showing());
        assert_eq!(crate::summary::format_token_count_en(12_345), "12k");
    }
}
