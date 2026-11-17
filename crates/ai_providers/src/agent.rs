//! The built-in agent's loop: ask the model, run the tools it calls, hand back their results, and
//! repeat until it answers without tools or the step budget runs out.
//!
//! Ported from Athas's `intelligence/services/intelligence-agent.ts` (the Vercel AI SDK's
//! `streamText` with `stopWhen: isStepCount`) and `intelligence/lib/intelligence-step-budget.ts`.

use futures::{FutureExt as _, StreamExt as _, future::BoxFuture};
use serde_json::Value;

use crate::{
    cancel::CancelToken,
    connection::Connection,
    http::ProviderError,
    message::{Event, FinishReason, Message, Part, Request, Role, ToolCall, ToolResult, ToolSpec, Usage},
};

/// The fewest and most model requests one turn may make (`aiAgentMaxSteps`).
pub const MIN_STEPS: usize = 1;
pub const MAX_STEPS: usize = 200;
pub const DEFAULT_STEPS: usize = 25;

pub fn normalize_max_steps(value: f64) -> usize {
    if !value.is_finite() || value <= 0. { DEFAULT_STEPS } else { (value.round() as usize).clamp(MIN_STEPS, MAX_STEPS) }
}

/// What one request of the loop may carry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StepLimits {
    pub max_messages: usize,
    pub max_bytes: usize,
}

impl StepLimits {
    /// Athas's hosted endpoint rejects larger requests; other providers get a generous cap that
    /// still keeps a long turn from growing without bound.
    pub fn for_provider(provider_id: &str) -> Self {
        if provider_id == crate::catalog::ATHAS {
            Self { max_messages: 200, max_bytes: 400_000 }
        } else {
            Self { max_messages: 1_000, max_bytes: 600_000 }
        }
    }
}

pub struct AgentConfig {
    pub system: String,
    pub tools: Vec<ToolSpec>,
    pub max_steps: usize,
    pub max_tokens: u64,
    pub limits: StepLimits,
}

/// What the loop reports while it runs.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentEvent {
    Text(String),
    Thinking(String),
    /// A request finished: its usage, the turn's total so far, and the cost so far when the
    /// provider reports one.
    Usage { step: Usage, total: Usage, cost: Option<f64> },
    /// The model the provider picked for an automatic choice.
    Model(String),
}

/// The side of the loop that shows its progress and runs its tools.
pub trait AgentHost: Send + Sync {
    fn event(&self, event: AgentEvent);
    fn call_tool(&self, call: ToolCall) -> BoxFuture<'static, ToolResult>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    EndTurn,
    /// It still wanted tools when the step budget ran out.
    MaxSteps,
    MaxTokens,
    Refusal,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TurnOutcome {
    pub stop: StopReason,
    pub steps: usize,
    pub usage: Usage,
    pub cost: Option<f64>,
}

const STOPPED: &str = "Stopped by the user";

/// Runs one turn. `history` ends with the user's message; the assistant's messages and tool
/// results are appended as they happen, so it stays a valid conversation even when stopped.
pub async fn run_turn(
    connection: &Connection,
    config: &AgentConfig,
    history: &mut Vec<Message>,
    host: &dyn AgentHost,
    cancel: &CancelToken,
) -> Result<TurnOutcome, ProviderError> {
    let first_step = history.len();
    let mut outcome = TurnOutcome { stop: StopReason::EndTurn, steps: 0, usage: Usage::default(), cost: None };
    let instruction_bytes = config.system.len() + serde_json::to_string(&config.tools).map_or(0, |tools| tools.len());
    loop {
        if cancel.is_cancelled() {
            outcome.stop = StopReason::Cancelled;
            return Ok(outcome);
        }
        let messages = fit_step_messages(history, config.limits, first_step, instruction_bytes).unwrap_or_else(|| history.clone());
        let request = Request {
            system: config.system.clone(),
            messages,
            tools: config.tools.clone(),
            max_tokens: config.max_tokens,
            temperature: None,
        };
        let stream = futures::select_biased! {
            _ = cancel.cancelled().fuse() => None,
            stream = connection.stream(&request).fuse() => Some(stream?),
        };
        let Some(mut stream) = stream else {
            outcome.stop = StopReason::Cancelled;
            return Ok(outcome);
        };
        let mut text = String::new();
        let mut calls: Vec<ToolCall> = Vec::new();
        let mut finish = FinishReason::Stop;
        let mut cancelled = false;
        let mut step_usage = None;
        loop {
            let next = futures::select_biased! {
                _ = cancel.cancelled().fuse() => {
                    cancelled = true;
                    break;
                }
                next = stream.next().fuse() => next,
            };
            match next {
                None => break,
                Some(Err(error)) => {
                    if !text.is_empty() {
                        history.push(Message::assistant(text));
                    }
                    return Err(error);
                }
                Some(Ok(event)) => match event {
                    Event::Text(delta) => {
                        text.push_str(&delta);
                        host.event(AgentEvent::Text(delta));
                    }
                    Event::Thinking(delta) => host.event(AgentEvent::Thinking(delta)),
                    Event::ToolCall(call) => calls.push(call),
                    Event::Usage(usage) => step_usage = Some(usage),
                    Event::Cost(cost) => {
                        let total = outcome.cost.unwrap_or_default() + cost;
                        outcome.cost = Some(total);
                    }
                    Event::Model(model) => host.event(AgentEvent::Model(model)),
                    Event::Finish(reason) => finish = reason,
                },
            }
        }
        outcome.steps += 1;
        if let Some(usage) = step_usage {
            outcome.usage.add(&usage);
            host.event(AgentEvent::Usage { step: usage, total: outcome.usage, cost: outcome.cost });
        }
        if cancelled {
            // What was said stays; tool calls that never ran are left out.
            if !text.is_empty() {
                history.push(Message::assistant(text));
            }
            outcome.stop = StopReason::Cancelled;
            return Ok(outcome);
        }
        let mut content = Vec::new();
        if !text.is_empty() {
            content.push(Part::Text { text });
        }
        content.extend(calls.iter().map(|call| Part::ToolCall { id: call.id.clone(), name: call.name.clone(), input: call.input.clone() }));
        if !content.is_empty() {
            history.push(Message { role: Role::Assistant, content });
        }
        if calls.is_empty() {
            outcome.stop = match finish {
                FinishReason::Length => StopReason::MaxTokens,
                FinishReason::Refusal => StopReason::Refusal,
                _ => StopReason::EndTurn,
            };
            return Ok(outcome);
        }
        let mut results = Vec::new();
        for call in calls {
            let result = if cancel.is_cancelled() {
                ToolResult::error(STOPPED)
            } else {
                futures::select_biased! {
                    result = host.call_tool(call.clone()).fuse() => result,
                    _ = cancel.cancelled().fuse() => ToolResult::error(STOPPED),
                }
            };
            results.push(Part::ToolResult { id: call.id, name: call.name, content: result.content, is_error: result.is_error });
        }
        history.push(Message { role: Role::Tool, content: results });
        if cancel.is_cancelled() {
            outcome.stop = StopReason::Cancelled;
            return Ok(outcome);
        }
        if outcome.steps >= config.max_steps {
            outcome.stop = StopReason::MaxSteps;
            return Ok(outcome);
        }
    }
}

pub const TRIMMED_TOOL_RESULT: &str = "[trimmed: re-read if needed]";
/// Tool results kept whole before any older one is trimmed.
const KEEP_RECENT_RESULTS: usize = 6;
/// Results this small cost less than the confusion of trimming them.
const MIN_TRIMMABLE_BYTES: usize = 400;

/// Tools whose output the model can fetch again, trimmed before anything else.
fn is_rereadable(tool: &str) -> bool {
    matches!(tool, "read_file" | "search_files" | "list_files") || tool.starts_with("mcp__")
}

/// The bytes a message adds to a request. Images count toward the provider's separate image
/// limit, not the text size.
fn message_bytes(message: &Message) -> usize {
    message
        .content
        .iter()
        .map(|part| match part {
            Part::Text { text } => text.len() + 16,
            Part::Image { .. } => 32,
            Part::ToolCall { id, name, input } => id.len() + name.len() + input.to_string().len() + 32,
            Part::ToolResult { id, name, content, .. } => id.len() + name.len() + content.len() + 32,
        })
        .sum::<usize>()
        + 16
}

/// Keeps one step's request inside `limits`. Older tool results become a short stub, rereadable
/// ones (file reads, searches, MCP calls) first and the most recent few last; when a turn has
/// more steps than the message cap allows, its oldest steps go. `None` when nothing had to change.
pub fn fit_step_messages(input: &[Message], limits: StepLimits, first_step: usize, instruction_bytes: usize) -> Option<Vec<Message>> {
    let total = |messages: &[Message]| messages.iter().map(message_bytes).sum::<usize>() + instruction_bytes;
    let mut bytes = total(input);
    if bytes <= limits.max_bytes && input.len() <= limits.max_messages {
        return None;
    }
    let mut messages = input.to_vec();
    if messages.len() > limits.max_messages {
        drop_oldest_steps(&mut messages, first_step, limits.max_messages);
        bytes = total(&messages);
    }
    let passes = [(KEEP_RECENT_RESULTS, true), (KEEP_RECENT_RESULTS, false), (1, false), (0, false)];
    for (keep, rereadable_only) in passes {
        if bytes <= limits.max_bytes {
            break;
        }
        let results: Vec<(usize, usize)> = messages
            .iter()
            .enumerate()
            .filter(|(_, message)| message.role == Role::Tool)
            .flat_map(|(index, message)| {
                message.content.iter().enumerate().filter_map(move |(part, content)| match content {
                    Part::ToolResult { content, .. } if content != TRIMMED_TOOL_RESULT => Some((index, part)),
                    _ => None,
                })
            })
            .collect();
        let trimmable = results.len().saturating_sub(keep);
        for &(index, part) in &results[..trimmable] {
            if bytes <= limits.max_bytes {
                break;
            }
            let Part::ToolResult { name, content, .. } = &mut messages[index].content[part] else { continue };
            if content.len() < MIN_TRIMMABLE_BYTES || (rereadable_only && !is_rereadable(name)) {
                continue;
            }
            bytes -= content.len() - TRIMMED_TOOL_RESULT.len();
            *content = TRIMMED_TOOL_RESULT.to_string();
        }
    }
    Some(messages)
}

/// Drops the oldest tool steps of this turn (an assistant's calls with their results, so every
/// call keeps its result) until the message count fits, and notes how many went.
fn drop_oldest_steps(messages: &mut Vec<Message>, first_step: usize, max_messages: usize) {
    let mut removed = 0;
    let index = first_step.min(messages.len());
    while messages.len() > max_messages && index + 2 < messages.len() {
        if messages[index].role != Role::Assistant || messages[index + 1].role != Role::Tool {
            break;
        }
        removed += 1 + steps_removed_note(&messages[index]);
        messages.drain(index..index + 2);
    }
    if removed == 0 {
        return;
    }
    if let Some(next) = messages.get_mut(index).filter(|message| message.role == Role::Assistant) {
        let total = removed + steps_removed_note(next);
        if steps_removed_note(next) > 0 {
            next.content.remove(0);
        }
        let note = format!("[{total} earlier tool step{} of this turn removed to fit the request limit]", if total == 1 { "" } else { "s" });
        next.content.insert(0, Part::Text { text: note });
    }
}

fn steps_removed_note(message: &Message) -> usize {
    let Some(Part::Text { text }) = message.content.first() else { return 0 };
    text.strip_prefix('[')
        .and_then(|rest| rest.split_once(" earlier tool step"))
        .and_then(|(count, _)| count.parse().ok())
        .unwrap_or_default()
}

/// What a turn's first request may hold (`ProviderRequestLimits`): messages, text bytes and
/// characters per message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestLimits {
    pub max_messages: usize,
    pub max_bytes: usize,
    pub max_message_chars: usize,
}

impl RequestLimits {
    /// Athas's hosted endpoint takes 360 messages and 560 KB of text here, less the room the tool
    /// loop needs on top (50 messages, 160 KB), with 200,000 characters per message
    /// (`getProviderRequestLimits`). `None` for other providers, which take what they take.
    pub fn for_provider(provider_id: &str) -> Option<Self> {
        (provider_id == crate::catalog::ATHAS).then_some(Self { max_messages: 360 - 50, max_bytes: 560_000 - 160_000, max_message_chars: 200_000 })
    }
}

/// Room kept for the summary of the turns a fitted request leaves out.
const SUMMARY_RESERVE_BYTES: usize = 12_000;

fn cap_text(message: &mut Message, max_chars: usize) {
    for part in &mut message.content {
        if let Part::Text { text } = part
            && text.chars().count() > max_chars
        {
            let kept: String = text.chars().take(max_chars).collect();
            *text = format!("{kept}\n[truncated]");
        }
    }
}

fn text_chars(message: &Message) -> usize {
    message.content.iter().map(|part| if let Part::Text { text } = part { text.chars().count() } else { 0 }).sum()
}

/// Fits a turn's history (the new user message last) to `limits` before it is sent
/// (`fitMessagesToProviderLimits`): oversized messages are truncated, then the oldest turns are
/// summarised away (by `summarize`) until the count and size hold. The summary leads the first
/// turn kept, so user and assistant messages keep alternating. Returns whether anything changed.
pub fn fit_request_to_limits(history: &mut Vec<Message>, instruction_bytes: usize, limits: RequestLimits, summarize: impl FnOnce(&[Message]) -> String) -> bool {
    let mut changed = false;
    for message in history.iter_mut() {
        if text_chars(message) > limits.max_message_chars {
            cap_text(message, limits.max_message_chars);
            changed = true;
        }
    }
    let bytes = |messages: &[Message]| messages.iter().map(message_bytes).sum::<usize>() + instruction_bytes;
    // The system prompt counts as one message on the wire.
    if history.len() < limits.max_messages && bytes(history) <= limits.max_bytes {
        return changed;
    }
    let Some(mut current) = history.pop() else { return changed };
    let base_limit = limits.max_bytes.saturating_sub(SUMMARY_RESERVE_BYTES);
    let base = bytes(std::slice::from_ref(&current));
    if base > base_limit {
        let excess = base - base_limit;
        let max_chars = text_chars(&current).saturating_sub(excess * 2).max(1_000);
        cap_text(&mut current, max_chars);
    }
    let conversation = std::mem::take(history);
    let current_bytes = message_bytes(&current);
    let fits = |from: usize| {
        let kept = &conversation[from..];
        1 + kept.len() + 2 <= limits.max_messages && bytes(kept) + current_bytes + SUMMARY_RESERVE_BYTES <= limits.max_bytes
    };
    let mut start = 0;
    while start < conversation.len() && !fits(start) {
        start += 1;
    }
    while start < conversation.len() && conversation[start].role != Role::User {
        start += 1;
    }
    if start == 0 {
        *history = conversation;
        history.push(current);
        return true;
    }
    let summary = format!("[Summary of {start} earlier messages in this conversation]\n{}\n[End of summary]", summarize(&conversation[..start]).trim());
    let mut kept: Vec<Message> = conversation.into_iter().skip(start).collect();
    let target = if kept.is_empty() { &mut current } else { &mut kept[0] };
    match target.content.iter_mut().find_map(|part| if let Part::Text { text } = part { Some(text) } else { None }) {
        Some(text) => *text = format!("{summary}\n\n{text}"),
        None => target.content.insert(0, Part::Text { text: summary }),
    }
    kept.push(current);
    *history = kept;
    true
}

/// A JSON object schema from `(name, schema, required)` fields.
pub fn object_schema(fields: &[(&str, Value, bool)]) -> Value {
    let properties: serde_json::Map<String, Value> = fields.iter().map(|(name, schema, _)| (name.to_string(), schema.clone())).collect();
    let required: Vec<&str> = fields.iter().filter(|(_, _, required)| *required).map(|(name, _, _)| *name).collect();
    serde_json::json!({ "type": "object", "properties": properties, "required": required, "additionalProperties": false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_requests_summarise_their_oldest_turns() {
        assert_eq!(RequestLimits::for_provider("openai"), None);
        let limits = RequestLimits { max_messages: 8, max_bytes: 100_000, max_message_chars: 200_000 };
        let mut history = Vec::new();
        for turn in 0..10 {
            history.push(Message::user(format!("question {turn}")));
            history.push(Message::assistant(format!("answer {turn}")));
        }
        history.push(Message::user("latest"));
        let changed = fit_request_to_limits(&mut history, 0, limits, |dropped| format!("{} dropped", dropped.len()));
        assert!(changed);
        assert!(history.len() + 1 <= limits.max_messages);
        assert_eq!(history[0].role, Role::User);
        assert!(history[0].text().starts_with("[Summary of 16 earlier messages in this conversation]\n16 dropped\n[End of summary]\n\nquestion 8"));
        assert_eq!(history.last().unwrap().text(), "latest");

        let mut small = vec![Message::user("a"), Message::assistant("b"), Message::user("c")];
        assert!(!fit_request_to_limits(&mut small, 0, limits, |_| String::new()));
        assert_eq!(small.len(), 3);

        let mut huge = vec![Message::user("x".repeat(300_000))];
        assert!(fit_request_to_limits(&mut huge, 0, RequestLimits { max_messages: 10, max_bytes: 1_000_000, max_message_chars: 200_000 }, |_| String::new()));
        assert_eq!(huge[0].text().chars().count(), 200_000 + "\n[truncated]".len());
    }

    fn tool_step(index: usize, name: &str, size: usize) -> [Message; 2] {
        let id = format!("c{index}");
        [
            Message {
                role: Role::Assistant,
                content: vec![Part::ToolCall { id: id.clone(), name: name.into(), input: serde_json::json!({}) }],
            },
            Message {
                role: Role::Tool,
                content: vec![Part::ToolResult { id, name: name.into(), content: "x".repeat(size), is_error: false }],
            },
        ]
    }

    #[test]
    fn small_requests_are_left_alone() {
        let messages = vec![Message::user("hi")];
        assert_eq!(fit_step_messages(&messages, StepLimits { max_messages: 10, max_bytes: 10_000 }, 1, 0), None);
    }

    #[test]
    fn trims_rereadable_results_first_and_keeps_recent_ones() {
        let mut messages = vec![Message::user("go")];
        messages.extend(tool_step(0, "run_command", 5_000));
        for index in 1..9 {
            messages.extend(tool_step(index, "read_file", 5_000));
        }
        let fitted = fit_step_messages(&messages, StepLimits { max_messages: 100, max_bytes: 40_000 }, 1, 0).unwrap();
        let contents: Vec<&str> = fitted
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(|part| match part {
                Part::ToolResult { content, .. } => Some(content.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(contents.len(), 9);
        assert_ne!(contents[0], TRIMMED_TOOL_RESULT, "the command's output outlives rereadable reads");
        assert_eq!(contents[1], TRIMMED_TOOL_RESULT);
        assert_ne!(contents[8], TRIMMED_TOOL_RESULT);
    }

    #[test]
    fn drops_the_oldest_steps_past_the_message_cap() {
        let mut messages = vec![Message::user("go")];
        for index in 0..5 {
            messages.extend(tool_step(index, "list_files", 10));
        }
        messages.push(Message::assistant("done"));
        let fitted = fit_step_messages(&messages, StepLimits { max_messages: 6, max_bytes: 1_000_000 }, 1, 0).unwrap();
        assert!(fitted.len() <= 6);
        assert_eq!(fitted[0], Message::user("go"));
        assert!(matches!(&fitted[1].content[0], Part::Text { text } if text.starts_with("[3 earlier tool steps")));
        assert!(matches!(&fitted[1].content[1], Part::ToolCall { id, .. } if id == "c3"));
    }

    #[test]
    fn steps_setting_is_clamped() {
        assert_eq!(normalize_max_steps(25.), 25);
        assert_eq!(normalize_max_steps(0.), DEFAULT_STEPS);
        assert_eq!(normalize_max_steps(9_999.), MAX_STEPS);
        assert_eq!(normalize_max_steps(f64::NAN), DEFAULT_STEPS);
    }
}
