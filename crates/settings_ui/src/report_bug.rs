//! Settings > General > Report a Bug (`ReportBugCommandDialog`): pick where to report, and Athas
//! copies a report template with the build and OS, or puts it in an email.

use gpui::{AnyElement, App, ClipboardItem, Context, SharedString, Window, prelude::*};
use notifications::NotificationKind;
use palette::{PaletteRow, Picker, PickerDelegate};
use ui::IconName;

use crate::notify;

pub struct Channel {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    pub url: &'static str,
}

pub const CHANNELS: &[Channel] = &[
    Channel { id: "discord", label: "Discord", detail: "Ask in the community server", url: "https://discord.gg/DD8F38wFMv" },
    Channel { id: "github", label: "GitHub", detail: "Open a bug report issue", url: "https://github.com/athasdev/athas/issues/new?template=01-bug.yml" },
    Channel { id: "twitter", label: "X", detail: "Message Athas on X", url: "https://x.com/athasindustries" },
    Channel { id: "email", label: "Email", detail: "Send a report to hey@athas.dev", url: "mailto:hey@athas.dev" },
];

/// The template a report starts from (`buildBugReport`).
pub fn bug_report() -> String {
    format!(
        "Environment\n\n- App: Athas {}\n- OS: {} {}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Where a channel sends the report: email gets it as the body, the others open with the
/// template on the clipboard.
pub fn channel_url(channel: &Channel, report: &str) -> String {
    if channel.id == "email" {
        format!("{}?subject={}&body={}", channel.url, encode("Athas bug report"), encode(report))
    } else {
        channel.url.to_string()
    }
}

pub fn report_via(channel: &Channel, cx: &mut App) {
    let report = bug_report();
    if channel.id != "email" {
        cx.write_to_clipboard(ClipboardItem::new_string(report.clone()));
        notify(cx, NotificationKind::Success, "Report template copied", None);
    }
    cx.open_url(&channel_url(channel, &report));
}

pub struct ReportBugDelegate {
    matches: Vec<usize>,
    selected: usize,
}

impl ReportBugDelegate {
    pub fn new() -> Self {
        Self { matches: (0..CHANNELS.len()).collect(), selected: 0 }
    }
}

impl PickerDelegate for ReportBugDelegate {
    fn placeholder(&self) -> SharedString {
        "Report via...".into()
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_string).collect();
        self.matches = CHANNELS
            .iter()
            .enumerate()
            .filter(|(_, channel)| {
                let haystack = format!("{} {}", channel.label, channel.detail).to_lowercase();
                words.iter().all(|word| haystack.contains(word))
            })
            .map(|(index, _)| index)
            .collect();
        self.selected = 0;
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let channel = &CHANNELS[self.matches[index]];
        PaletteRow::new(channel.label).description(channel.detail).selected(selected).into_any_element()
    }

    fn confirm(&mut self, index: usize, _: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(channel) = self.matches.get(index).and_then(|index| CHANNELS.get(*index)) else { return false };
        report_via(channel, cx);
        true
    }

    fn empty_message(&self) -> SharedString {
        "No report channel matches.".into()
    }

    fn leading_icon(&self) -> IconName {
        IconName::Bug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_reports_carry_the_template() {
        let report = bug_report();
        assert!(report.starts_with("Environment\n\n- App: Athas "));
        let email = channel_url(&CHANNELS[3], &report);
        assert!(email.starts_with("mailto:hey@athas.dev?subject=Athas%20bug%20report&body=Environment%0A%0A"));
        assert_eq!(channel_url(&CHANNELS[1], &report), CHANNELS[1].url);
    }
}
