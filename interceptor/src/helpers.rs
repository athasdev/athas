use crate::types::{ContentBlock, MessageContent, ParsedMessage, Role};
use thin_logger::log::{debug, info};

/// Extracts text content and tool results from message blocks
pub fn extract_content_from_blocks(blocks: &[ContentBlock]) -> (Vec<String>, Vec<String>) {
    let mut text_parts = Vec::new();
    let mut tool_results = Vec::new();

    for block in blocks {
        match block.content_type.as_str() {
            "text" => {
                if let Some(text) = &block.text {
                    text_parts.push(text.clone());
                }
            }
            "tool_result" => {
                if let Some(id) = &block.tool_use_id {
                    tool_results.push(format!("[Tool Result: {}]", id));
                }
            }
            _ => {}
        }
    }

    (text_parts, tool_results)
}

/// Extracts text content and tool uses from response blocks
pub fn extract_response_content(blocks: &[ContentBlock]) -> (Vec<String>, Vec<String>) {
    let mut text_parts = Vec::new();
    let mut tool_uses = Vec::new();

    for block in blocks {
        match block.content_type.as_str() {
            "text" => {
                if let Some(text) = &block.text {
                    text_parts.push(text.clone());
                }
            }
            "tool_use" => {
                if let Some(name) = &block.name {
                    tool_uses.push(name.clone());
                }
            }
            _ => {}
        }
    }

    (text_parts, tool_uses)
}

/// Truncates a string to a maximum length, appending "..." if truncated
pub fn truncate_for_display(text: &str, max_length: usize) -> String {
    if text.len() > max_length {
        format!("{}...", &text[..max_length - 3])
    } else {
        text.to_string()
    }
}

/// Logs user messages from the request
pub fn log_user_messages(messages: &[ParsedMessage]) {
    for msg in messages {
        if matches!(msg.role, Role::User) {
            let content = match &msg.content {
                MessageContent::Text(text) => text.clone(),
                MessageContent::Blocks(blocks) => {
                    let (text_parts, tool_results) = extract_content_from_blocks(blocks);

                    if !tool_results.is_empty() {
                        info!("🔄 Tool results: {}", tool_results.join(", "));
                    }

                    text_parts.join(" ")
                }
            };

            if !content.is_empty() {
                let preview = truncate_for_display(&content, 30);
                info!(
                    "(👤 user -> 🌐 anthropic) content length: {}",
                    content.len()
                );
                debug!("(👤 user -> 🌐 anthropic) content preview: {}", preview);
            }
        }
    }
}

/// Logs assistant response with tool usage
pub fn log_assistant_response(
    text_parts: &[String],
    tool_uses: &[String],
    duration_ms: u64,
    is_streaming: bool,
) {
    if !tool_uses.is_empty() {
        info!("🔧 Tools called: {}", tool_uses.join(", "));
    }

    if !text_parts.is_empty() {
        let response_text = text_parts.join(" ");
        let display_response = truncate_for_display(&response_text, 150);
        let mode_icon = if is_streaming { "🌊" } else { "📦" };
        info!(
            "{} 🤖 Assistant [{}] ({}ms): {}",
            mode_icon,
            if is_streaming { "STREAM" } else { "FULL" },
            duration_ms,
            display_response
        );
    }
}
