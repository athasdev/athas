//! Product feedback (`features/feedback`): what you were doing, what happened and what you
//! expected, optionally with a sanitized environment, drafted as a GitHub issue the user reviews
//! in the browser before sending. Athas has no feedback endpoint; this is the same flow.

use ui::scale::px;
use gpui::{
    App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render, Styled, Subscription,
    Window, div, prelude::*,
};
use telemetry::{FrictionArea, FrictionKind, FrictionSignal};
use theme::ActiveTheme;
use ui::{Button, ButtonVariant, Dialog, DialogLayout, DialogSize, IconName, Switch, TextArea, TextAreaEvent, typography};

use crate::widgets;

const MAX_FIELD_LENGTH: usize = 1_200;
const ISSUES_URL: &str = "https://github.com/athasdev/athas/issues/new";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FeedbackDraft {
    pub intent: String,
    pub actual: String,
    pub expected: String,
}

impl FeedbackDraft {
    pub fn is_complete(&self) -> bool {
        [&self.intent, &self.actual, &self.expected].iter().all(|field| !field.trim().is_empty())
    }
}

/// The build and OS, and counts of content-free friction signals. Never prompts, paths,
/// filenames, errors or editor text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FeedbackEnvironment {
    pub app_version: String,
    pub os: String,
    pub friction_signals: Vec<(String, usize)>,
}

impl FeedbackEnvironment {
    pub fn current(app_version: &str, cx: &App) -> Self {
        Self {
            app_version: app_version.to_string(),
            os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            friction_signals: telemetry::friction_counts(&telemetry::log_entries(cx)),
        }
    }
}

fn normalize(field: &str) -> String {
    field.trim().chars().take(MAX_FIELD_LENGTH).collect()
}

pub fn issue_body(draft: &FeedbackDraft, environment: Option<&FeedbackEnvironment>) -> String {
    let mut sections = vec![
        format!("## Intent\n\n{}", normalize(&draft.intent)),
        format!("## What happened\n\n{}", normalize(&draft.actual)),
        format!("## What I expected\n\n{}", normalize(&draft.expected)),
    ];
    if let Some(environment) = environment {
        let signals = if environment.friction_signals.is_empty() {
            "- None recorded".to_string()
        } else {
            environment.friction_signals.iter().map(|(name, count)| format!("- {name}: {count}")).collect::<Vec<_>>().join("\n")
        };
        sections.push(format!(
            "## Sanitized environment\n\n- App: Athas {}\n- OS: {}\n\nRecent content-free friction signals:\n{signals}",
            environment.app_version, environment.os
        ));
    }
    format!("{}\n", sections.join("\n\n"))
}

/// The GitHub "new issue" page with the draft filled in.
pub fn issue_url(draft: &FeedbackDraft, environment: Option<&FeedbackEnvironment>) -> String {
    let intent = normalize(&draft.intent);
    let first_line = intent.lines().next().filter(|line| !line.is_empty()).unwrap_or("Product feedback");
    let title = format!("Feedback: {}", first_line.chars().take(80).collect::<String>());
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("title", &title)
        .append_pair("body", &issue_body(draft, environment))
        .finish();
    format!("{ISSUES_URL}?{query}")
}

pub struct FeedbackDialog {
    app_version: String,
    intent: Entity<TextArea>,
    actual: Entity<TextArea>,
    expected: Entity<TextArea>,
    include_environment: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for FeedbackDialog {}

impl Focusable for FeedbackDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.intent.focus_handle(cx)
    }
}

impl FeedbackDialog {
    pub fn new(app_version: impl Into<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // Three-row text areas with no placeholder, as the original's `Textarea rows={3}`.
        let input = |cx: &mut Context<Self>| cx.new(|cx| TextArea::new(cx).rows(3));
        let intent = input(cx);
        let actual = input(cx);
        let expected = input(cx);
        let subscriptions = [&intent, &actual, &expected]
            .into_iter()
            .map(|input| {
                cx.subscribe(input, |this, _, event: &TextAreaEvent, cx| match event {
                    TextAreaEvent::Changed => cx.notify(),
                    TextAreaEvent::Submit => this.submit(cx),
                    TextAreaEvent::Cancelled => cx.emit(DismissEvent),
                })
            })
            .collect();
        intent.update(cx, |input, cx| input.focus(window, cx));
        telemetry::record_friction(cx, FrictionSignal::new(FrictionArea::Feedback, FrictionKind::Opened));
        Self { app_version: app_version.into(), intent, actual, expected, include_environment: true, _subscriptions: subscriptions }
    }

    fn draft(&self, cx: &App) -> FeedbackDraft {
        FeedbackDraft {
            intent: self.intent.read(cx).text().to_string(),
            actual: self.actual.read(cx).text().to_string(),
            expected: self.expected.read(cx).text().to_string(),
        }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let draft = self.draft(cx);
        if !draft.is_complete() {
            return;
        }
        let environment = self.include_environment.then(|| FeedbackEnvironment::current(&self.app_version, cx));
        cx.open_url(&issue_url(&draft, environment.as_ref()));
        telemetry::record_friction(cx, FrictionSignal::new(FrictionArea::Feedback, FrictionKind::Submitted));
        cx.emit(DismissEvent);
    }
}

impl Render for FeedbackDialog {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let complete = self.draft(cx).is_complete();
        let include = self.include_environment;
        let this = cx.entity().downgrade();
        let body = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(widgets::field("What were you trying to do?", self.intent.clone(), None, cx))
            .child(widgets::field("What happened?", self.actual.clone(), None, cx))
            .child(widgets::field("What did you expect?", self.expected.clone(), None, cx))
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(16.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(2.))
                            .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).child("Include sanitized environment"))
                            .child(div().text_size(typography::text_sm()).line_height(px(18.)).text_color(colors.muted_foreground).child(
                                "Adds the Athas version, OS, and counts of content-free friction signals. It never includes prompts, paths, filenames, errors, or editor text.",
                            )),
                    )
                    .child(Switch::new("feedback-environment", include).on_change(move |checked, _, cx| {
                        this.update(cx, |this, cx| {
                            this.include_environment = checked;
                            cx.notify();
                        })
                        .ok();
                    })),
            );
        let footer = [
            Button::new("feedback-cancel", "Cancel").on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent))),
            Button::new("feedback-submit", "Review on GitHub")
                .variant(ButtonVariant::Accent)
                .disabled(!complete)
                .on_click(cx.listener(|this, _, _, cx| this.submit(cx))),
        ];
        let close = cx.entity().downgrade();
        Dialog::new("feedback-dialog", "Send Product Feedback")
            .icon(IconName::ChatBubbleText)
            .size(DialogSize::Lg)
            .layout(DialogLayout::Default)
            .footer(footer)
            .on_close(move |_, cx| {
                close.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .child(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> FeedbackDraft {
        FeedbackDraft { intent: "  Share a session\nwith my team ".into(), actual: "It failed".into(), expected: "A link".into() }
    }

    #[test]
    fn builds_the_issue_body() {
        let environment = FeedbackEnvironment {
            app_version: "0.1.0".into(),
            os: "macos aarch64".into(),
            friction_signals: vec![("friction:feedback:opened".into(), 2)],
        };
        let body = issue_body(&draft(), Some(&environment));
        assert!(body.starts_with("## Intent\n\nShare a session\nwith my team\n\n## What happened\n\nIt failed"));
        assert!(body.contains("- App: Athas 0.1.0\n- OS: macos aarch64"));
        assert!(body.contains("- friction:feedback:opened: 2"));
        assert!(!issue_body(&draft(), None).contains("Sanitized environment"));
        let empty = FeedbackEnvironment { friction_signals: Vec::new(), ..environment };
        assert!(issue_body(&draft(), Some(&empty)).contains("- None recorded"));
    }

    #[test]
    fn builds_the_issue_url() {
        let url = issue_url(&draft(), None);
        assert!(url.starts_with("https://github.com/athasdev/athas/issues/new?title=Feedback%3A+Share+a+session&body=%23%23+Intent"));
        let long = FeedbackDraft { intent: "x".repeat(2_000), ..draft() };
        assert!(issue_body(&long, None).contains(&"x".repeat(MAX_FIELD_LENGTH)));
        assert!(!issue_body(&long, None).contains(&"x".repeat(MAX_FIELD_LENGTH + 1)));
    }

    #[test]
    fn needs_every_field() {
        assert!(draft().is_complete());
        assert!(!FeedbackDraft { expected: " ".into(), ..draft() }.is_complete());
    }
}
