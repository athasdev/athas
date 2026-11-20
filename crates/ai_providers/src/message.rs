//! A conversation as the model sees it, independent of any provider's wire format.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    /// Results of the assistant's tool calls.
    Tool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Part {
    Text { text: String },
    /// Base64 image data.
    Image { media_type: String, data: String },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, name: String, content: String, is_error: bool },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<Part>,
}

impl Message {
    pub fn user(text: impl Into<String>) -> Self {
        Self { role: Role::User, content: vec![Part::Text { text: text.into() }] }
    }

    pub fn assistant(text: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: vec![Part::Text { text: text.into() }] }
    }

    /// The message's text parts joined.
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|part| match part {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    pub fn tool_calls(&self) -> impl Iterator<Item = ToolCall> + '_ {
        self.content.iter().filter_map(|part| match part {
            Part::ToolCall { id, name, input } => Some(ToolCall { id: id.clone(), name: name.clone(), input: input.clone() }),
            _ => None,
        })
    }
}

/// A tool the model may call.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    /// JSON Schema of the input object.
    pub input_schema: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// What the model gets back from a tool.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

impl ToolResult {
    pub fn ok(content: impl Into<String>) -> Self {
        Self { content: content.into(), is_error: false }
    }

    pub fn error(content: impl Into<String>) -> Self {
        Self { content: content.into(), is_error: true }
    }

    pub fn json(value: &impl Serialize) -> Self {
        Self::ok(serde_json::to_string(value).unwrap_or_default())
    }
}

/// One model request: what it is told, the conversation, and the tools it may call.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Request {
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub max_tokens: u64,
    pub temperature: Option<f32>,
}

/// Tokens a request used.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

impl Usage {
    /// Tokens the context held after the request: everything read and written.
    pub fn context_tokens(&self) -> u64 {
        self.input_tokens + self.cache_read_tokens + self.cache_write_tokens + self.output_tokens
    }

    pub fn add(&mut self, other: &Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
    }
}

/// Why the model stopped answering a request.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FinishReason {
    #[default]
    Stop,
    ToolCalls,
    /// It ran out of output tokens.
    Length,
    /// The provider's safety filter stopped it.
    Refusal,
}

/// What streams back from one model request.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Text(String),
    Thinking(String),
    ToolCall(ToolCall),
    Usage(Usage),
    /// The provider's cost of the request in US dollars, when it reports one.
    Cost(f64),
    /// The model the provider chose, when the request asked for an automatic one.
    Model(String),
    Finish(FinishReason),
}

/// Inline images the hosted Athas endpoint accepts, in decoded bytes (`HOSTED_ATHAS_IMAGE_LIMITS`):
/// PNG, JPEG, GIF and WebP, up to 16 per request, 1.5 MB each and 2.25 MB in total.
pub const HOSTED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];
pub const HOSTED_MAX_IMAGES: usize = 16;
pub const HOSTED_MAX_IMAGE_BYTES: usize = 1_500_000;
pub const HOSTED_MAX_TOTAL_IMAGE_BYTES: usize = 2_250_000;

fn decoded_bytes(base64: &str) -> usize {
    let padding = base64.len() - base64.trim_end_matches('=').len();
    (base64.len() * 3 / 4).saturating_sub(padding)
}

fn image_count(message: &Message) -> usize {
    message.content.iter().filter(|part| matches!(part, Part::Image { .. })).count()
}

/// Images of the last user message, the one being sent (`currentImageCount`).
pub fn current_image_count(messages: &[Message]) -> usize {
    messages.iter().rev().find(|message| message.role == Role::User).map_or(0, image_count)
}

/// Adds `[N images omitted: reason]` to a message's text (`withOmittedNote`).
fn add_omitted_note(message: &mut Message, count: usize, reason: &str) {
    let note = format!("[{count} image{} omitted: {reason}]", if count == 1 { "" } else { "s" });
    match message.content.iter_mut().find_map(|part| match part {
        Part::Text { text } => Some(text),
        _ => None,
    }) {
        Some(text) if !text.is_empty() => {
            text.push_str("\n\n");
            text.push_str(&note);
        }
        Some(text) => *text = note,
        None => message.content.insert(0, Part::Text { text: note }),
    }
}

/// Drops every user image for a model that reads none (`withoutImages`).
pub fn strip_images(messages: &mut [Message]) {
    for message in messages.iter_mut().filter(|message| message.role == Role::User) {
        let count = image_count(message);
        if count > 0 {
            message.content.retain(|part| !matches!(part, Part::Image { .. }));
            add_omitted_note(message, count, "this model does not accept images");
        }
    }
}

/// Keeps the images the hosted endpoint accepts, newest first: an allowed type, under the
/// per-image size, and within the request's count and total size (`withinHostedImageLimits`).
/// The rest are left out with a note, so an old screenshot never blocks the conversation.
pub fn fit_hosted_images(messages: &mut [Message]) {
    let (mut count, mut total) = (0usize, 0usize);
    for message in messages.iter_mut().rev().filter(|message| message.role == Role::User) {
        let images = image_count(message);
        if images == 0 {
            continue;
        }
        let mut dropped = 0;
        let mut keep = vec![true; message.content.len()];
        for (index, part) in message.content.iter().enumerate().rev() {
            let Part::Image { media_type, data } = part else { continue };
            let bytes = decoded_bytes(data);
            if !HOSTED_IMAGE_TYPES.contains(&media_type.to_lowercase().as_str()) || bytes > HOSTED_MAX_IMAGE_BYTES || count + 1 > HOSTED_MAX_IMAGES || total + bytes > HOSTED_MAX_TOTAL_IMAGE_BYTES {
                keep[index] = false;
                dropped += 1;
                continue;
            }
            count += 1;
            total += bytes;
        }
        if dropped > 0 {
            let mut keep = keep.into_iter();
            message.content.retain(|_| keep.next().unwrap_or(true));
            add_omitted_note(message, dropped, "over the image size or count limit");
        }
    }
}

/// What to tell the user when images of the message being sent were left out
/// (`imagesOmittedNotice`).
pub fn images_omitted_notice(omitted: usize, accepts_images: bool, model_name: &str) -> String {
    let images = if omitted == 1 { "An image was".to_string() } else { format!("{omitted} images were") };
    if !accepts_images {
        return format!("{images} not sent: {model_name} cannot read images. Choose a model that supports images to include them.");
    }
    format!("{images} not sent: Athas AI takes PNG, JPEG, GIF or WebP images up to 1.5 MB each and 2.25 MB per request.")
}

#[cfg(test)]
mod image_tests {
    use super::*;

    fn with_images(text: &str, images: &[(&str, usize)]) -> Message {
        let mut message = Message::user(text);
        message.content.extend(images.iter().map(|(media_type, bytes)| Part::Image { media_type: media_type.to_string(), data: "A".repeat(bytes * 4 / 3) }));
        message
    }

    #[test]
    fn hosted_requests_keep_the_newest_images_that_fit() {
        let mut messages = vec![with_images("old", &[("image/png", 1_000_000)]), Message::assistant("ok"), with_images("new", &[("image/png", 1_400_000), ("image/bmp", 10)])];
        assert_eq!(current_image_count(&messages), 2);
        fit_hosted_images(&mut messages);
        assert_eq!(current_image_count(&messages), 1);
        assert_eq!(messages[2].text(), "new\n\n[1 image omitted: over the image size or count limit]");
        assert_eq!(messages[0].text(), "old\n\n[1 image omitted: over the image size or count limit]");
        assert_eq!(image_count(&messages[0]), 0);
    }

    #[test]
    fn text_only_models_get_notes_instead_of_images() {
        let mut messages = vec![with_images("", &[("image/png", 10), ("image/png", 10)])];
        strip_images(&mut messages);
        assert_eq!(messages[0].text(), "[2 images omitted: this model does not accept images]");
        assert_eq!(images_omitted_notice(1, false, "DeepSeek"), "An image was not sent: DeepSeek cannot read images. Choose a model that supports images to include them.");
        assert!(images_omitted_notice(3, true, "x").starts_with("3 images were not sent: Athas AI takes"));
    }
}
