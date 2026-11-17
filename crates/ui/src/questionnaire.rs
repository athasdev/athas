//! A question flow one step at a time (`ui/questionnaire.tsx`): each step offers choices (radios,
//! or checkboxes when several may be picked) and may take a typed answer, alone or beside them.

use gpui::{App, ClickEvent, Context, Entity, EventEmitter, IntoElement, Render, SharedString, Subscription, Window, div, prelude::*, px};
use theme::ActiveTheme;

use crate::{Button, ButtonVariant, Icon, IconName, IconSize, TextInput, TextInputEvent, metrics, typography};

#[derive(Clone, Debug, PartialEq)]
pub struct QuestionnaireChoice {
    pub value: SharedString,
    pub label: SharedString,
    pub description: Option<SharedString>,
}

impl QuestionnaireChoice {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), description: None }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }
}

/// One step (`QuestionnaireItem`).
#[derive(Clone, Debug, PartialEq)]
pub struct QuestionnaireQuestion {
    pub name: SharedString,
    pub title: SharedString,
    pub description: Option<SharedString>,
    pub choices: Vec<QuestionnaireChoice>,
    pub multiple: bool,
    /// A field for a typed answer, with this placeholder.
    pub input: Option<SharedString>,
    pub required: bool,
}

impl QuestionnaireQuestion {
    pub fn new(name: impl Into<SharedString>, title: impl Into<SharedString>) -> Self {
        Self { name: name.into(), title: title.into(), description: None, choices: Vec::new(), multiple: false, input: None, required: false }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn choice(mut self, choice: QuestionnaireChoice) -> Self {
        self.choices.push(choice);
        self
    }

    pub fn multiple(mut self) -> Self {
        self.multiple = true;
        self
    }

    pub fn input(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.input = Some(placeholder.into());
        self
    }

    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }
}

/// The answers by question name: the chosen values, then the typed text if any.
#[derive(Clone, Debug, PartialEq)]
pub enum QuestionnaireEvent {
    Submitted(Vec<(SharedString, Vec<SharedString>)>),
}

pub struct Questionnaire {
    questions: Vec<QuestionnaireQuestion>,
    step: usize,
    chosen: Vec<Vec<SharedString>>,
    inputs: Vec<Option<Entity<TextInput>>>,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<QuestionnaireEvent> for Questionnaire {}

impl Questionnaire {
    pub fn new(questions: Vec<QuestionnaireQuestion>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut subscriptions = Vec::new();
        let inputs = questions
            .iter()
            .map(|question| {
                question.input.clone().map(|placeholder| {
                    let input = cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder));
                    subscriptions.push(cx.subscribe(&input, |this: &mut Self, _, event: &TextInputEvent, cx| match event {
                        TextInputEvent::Confirmed => this.next(cx),
                        TextInputEvent::Changed(_) => {
                            this.error = None;
                            cx.notify();
                        }
                        _ => {}
                    }));
                    input
                })
            })
            .collect();
        Self { chosen: vec![Vec::new(); questions.len()], questions, step: 0, inputs, error: None, _subscriptions: subscriptions }
    }

    pub fn step(&self) -> usize {
        self.step
    }

    /// The answer to question `index` so far.
    pub fn answer(&self, index: usize, cx: &App) -> Vec<SharedString> {
        let mut answer = self.chosen.get(index).cloned().unwrap_or_default();
        if let Some(Some(input)) = self.inputs.get(index) {
            let text = input.read(cx).text().trim().to_string();
            if !text.is_empty() {
                answer.push(text.into());
            }
        }
        answer
    }

    /// Picks a choice of the current question, or unpicks it when several may be picked.
    pub fn choose(&mut self, value: SharedString, cx: &mut Context<Self>) {
        let Some(question) = self.questions.get(self.step) else { return };
        let chosen = &mut self.chosen[self.step];
        if question.multiple {
            match chosen.iter().position(|item| *item == value) {
                Some(position) => {
                    chosen.remove(position);
                }
                None => chosen.push(value),
            }
        } else {
            *chosen = vec![value];
        }
        self.error = None;
        cx.notify();
    }

    pub fn previous(&mut self, cx: &mut Context<Self>) {
        self.step = self.step.saturating_sub(1);
        self.error = None;
        cx.notify();
    }

    /// Moves on without answering; required questions cannot be skipped.
    pub fn skip(&mut self, cx: &mut Context<Self>) {
        if self.questions.get(self.step).is_some_and(|question| question.required) {
            return;
        }
        self.chosen[self.step].clear();
        self.advance(cx);
    }

    /// Moves on (or submits on the last step) once a required question has an answer.
    pub fn next(&mut self, cx: &mut Context<Self>) {
        if self.questions.get(self.step).is_some_and(|question| question.required) && self.answer(self.step, cx).is_empty() {
            self.error = Some("This question needs an answer".into());
            cx.notify();
            return;
        }
        self.advance(cx);
    }

    fn advance(&mut self, cx: &mut Context<Self>) {
        self.error = None;
        if self.step + 1 < self.questions.len() {
            self.step += 1;
        } else {
            let answers = self.questions.iter().enumerate().map(|(index, question)| (question.name.clone(), self.answer(index, cx))).collect();
            cx.emit(QuestionnaireEvent::Submitted(answers));
        }
        cx.notify();
    }
}

impl Render for Questionnaire {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let Some(question) = self.questions.get(self.step).cloned() else { return div() };
        let total = self.questions.len();
        let last = self.step + 1 == total;
        let chosen = self.chosen[self.step].clone();
        let choices = question.choices.iter().enumerate().map(|(index, choice)| {
            let checked = chosen.contains(&choice.value);
            let value = choice.value.clone();
            let hover = colors.accent;
            let indicator = div()
                .mt(px(2.))
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(14.))
                .border_1()
                .map(|this| if question.multiple { this.rounded(px(3.)) } else { this.rounded_full() })
                .border_color(if checked { colors.primary } else { colors.border_strong })
                .bg(if checked { colors.primary } else { colors.background })
                .when(checked && question.multiple, |this| this.child(Icon::new(IconName::Check).size(IconSize::Custom(px(12.))).color(colors.primary_foreground)))
                .when(checked && !question.multiple, |this| this.child(div().size(px(6.)).rounded_full().bg(colors.primary_foreground)));
            div()
                .id(SharedString::from(format!("questionnaire-choice-{index}")))
                .flex()
                .items_start()
                .gap(px(8.))
                .px(px(10.))
                .py(px(8.))
                .rounded(metrics::RADIUS_MD)
                .text_size(typography::TEXT_SM)
                .text_color(colors.foreground)
                .map(|this| if checked { this.bg(colors.primary_soft).border_1().border_color(colors.primary) } else { this.bg(colors.raised).shadow(theme.shadows.raised.clone()).hover(move |style| style.bg(hover)) })
                .child(indicator)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(2.))
                        .child(choice.label.clone())
                        .children(choice.description.clone().map(|description| div().text_color(colors.muted_foreground).child(description))),
                )
                .when(index < 9, |this| {
                    this.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(16.))
                            .rounded(px(3.))
                            .border_1()
                            .border_color(colors.border)
                            .bg(colors.background)
                            .font_family(typography::MONO_FONT)
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.subtle_foreground)
                            .child((index + 1).to_string()),
                    )
                })
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.choose(value.clone(), cx)))
        });
        let input = self.inputs.get(self.step).cloned().flatten();
        div()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .gap(px(12.))
            .font_family(typography::UI_FONT)
            .child(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(format!("{} of {total}", self.step + 1)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(question.title.clone()))
                    .children(question.description.clone().map(|description| div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(description)))
                    .when(!question.choices.is_empty(), |this| this.child(div().flex().flex_col().gap(px(6.)).children(choices)))
                    .children(input)
                    .children(self.error.clone().map(|error| div().text_size(typography::TEXT_SM).text_color(colors.destructive).child(error))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(div().flex_1().when(self.step > 0, |this| {
                        this.child(Button::new("questionnaire-previous", "Previous").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _, _, cx| this.previous(cx))))
                    }))
                    .when(!question.required, |this| {
                        this.child(Button::new("questionnaire-skip", "Skip").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _, _, cx| this.skip(cx))))
                    })
                    .child(
                        Button::new("questionnaire-next", if last { "Submit" } else { "Next" })
                            .variant(ButtonVariant::Accent)
                            .on_click(cx.listener(|this, _, _, cx| this.next(cx))),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use super::*;

    #[gpui::test]
    fn steps_through_and_submits_the_answers(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| theme::init(cx, None, theme::Appearance::Dark, false));
        let window = cx.add_window(|window, cx| {
            Questionnaire::new(
                vec![
                    QuestionnaireQuestion::new("scope", "Which files?").choice(QuestionnaireChoice::new("all", "All")).choice(QuestionnaireChoice::new("open", "Open")).required(),
                    QuestionnaireQuestion::new("checks", "Run which checks?").multiple().choice(QuestionnaireChoice::new("lint", "Lint")).choice(QuestionnaireChoice::new("test", "Test")),
                    QuestionnaireQuestion::new("note", "Anything else?").input("Note"),
                ],
                window,
                cx,
            )
        });
        let submitted = Rc::new(RefCell::new(None));
        let seen = submitted.clone();
        let questionnaire = window.root(cx).unwrap();
        cx.update(|cx| {
            cx.subscribe(&questionnaire, move |_, event: &QuestionnaireEvent, _| {
                let QuestionnaireEvent::Submitted(answers) = event;
                *seen.borrow_mut() = Some(answers.clone());
            })
            .detach()
        });
        questionnaire.update(cx, |this, cx| {
            this.next(cx);
            assert_eq!(this.step(), 0, "a required question waits for an answer");
            this.choose("open".into(), cx);
            this.next(cx);
            this.choose("lint".into(), cx);
            this.choose("test".into(), cx);
            this.choose("lint".into(), cx);
            this.next(cx);
            assert_eq!(this.step(), 2);
            this.skip(cx);
        });
        assert_eq!(
            submitted.borrow().clone().unwrap(),
            vec![("scope".into(), vec!["open".into()]), ("checks".into(), vec!["test".into()]), ("note".into(), Vec::new())]
        );
    }
}
