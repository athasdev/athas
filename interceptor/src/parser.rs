use crate::types::{ChunkType, ContentBlock, Delta, ParsedResponse, StreamingChunk};
use anyhow::Result;
use thin_logger::log;

impl ParsedResponse {
    fn append_content_block(&mut self, block: ContentBlock) {
        self.content.push(block);
    }

    fn append_text_to_last_block(&mut self, text: &str) {
        if let Some(last_block) = self.content.last_mut() {
            if last_block.content_type == "text" {
                match &mut last_block.text {
                    Some(existing_text) => existing_text.push_str(text),
                    None => last_block.text = Some(text.to_string()),
                }
            }
        }
    }

    fn append_partial_json_to_last_block(&mut self, partial_json: &str) {
        if let Some(last_block) = self.content.last_mut() {
            if last_block.content_type == "tool_use" {
                // For tool_use blocks, accumulate partial JSON into a temporary string
                // We'll parse it when the block is complete
                match &mut last_block.input {
                    Some(serde_json::Value::String(json_str)) => {
                        json_str.push_str(partial_json);
                    }
                    Some(_) => {
                        // this is being fired A LOT after every tool use and i don't know why (commenting it out for now)
                        // log::warn!("Unexpected: tool_use block already has parsed input");
                    }
                    None => {
                        last_block.input =
                            Some(serde_json::Value::String(partial_json.to_string()));
                    }
                }
            }
        }
    }

    fn finalize_tool_use_block(&mut self) {
        if let Some(last_block) = self.content.last_mut() {
            if last_block.content_type == "tool_use" {
                // Parse accumulated JSON string into proper JSON value
                if let Some(serde_json::Value::String(json_str)) = &last_block.input {
                    match serde_json::from_str::<serde_json::Value>(json_str) {
                        Ok(parsed_json) => {
                            last_block.input = Some(parsed_json);
                        }
                        Err(e) => {
                            log::error!(
                                "Failed to parse tool_use input JSON: {} - Error: {}",
                                json_str,
                                e
                            );
                            // Keep the raw string on error
                        }
                    }
                }
            }
        }
    }

    fn set_stop_info(&mut self, stop_reason: Option<String>, stop_sequence: Option<String>) {
        if let Some(reason) = stop_reason {
            self.stop_reason = Some(reason);
        }
        self.stop_sequence = stop_sequence;
    }
}

fn process_message_start(chunk: &StreamingChunk) -> Option<ParsedResponse> {
    chunk.message.as_ref().map(|message| ParsedResponse {
        id: message.id.clone(),
        response_type: message.message_type.clone(),
        role: message.role.clone(),
        model: message.model.clone(),
        content: Vec::new(),
        usage: message.usage.clone(),
        stop_reason: None,
        stop_sequence: None,
        error: None,
    })
}

fn process_content_block_start(chunk: &StreamingChunk, response: &mut ParsedResponse) {
    if let Some(content_block) = &chunk.content_block {
        response.append_content_block(content_block.clone());
    }
}

fn process_content_block_delta(delta: &Delta, response: &mut ParsedResponse) {
    if let Some(text) = &delta.text {
        response.append_text_to_last_block(text);
    }
    if let Some(partial_json) = &delta.partial_json {
        response.append_partial_json_to_last_block(partial_json);
    }
}

fn process_message_delta(delta: &Delta, response: &mut ParsedResponse) {
    response.set_stop_info(delta.stop_reason.clone(), delta.stop_sequence.clone());
}

pub fn parse_streaming_response(
    response_text: &str,
) -> Result<(Vec<StreamingChunk>, Option<ParsedResponse>)> {
    let mut chunks = Vec::new();
    let mut final_response: Option<ParsedResponse> = None;

    for line in response_text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                continue;
            }

            match serde_json::from_str::<StreamingChunk>(data) {
                Ok(chunk) => {
                    match chunk.chunk_type {
                        ChunkType::MessageStart => {
                            final_response = process_message_start(&chunk);
                        }
                        ChunkType::ContentBlockStart => {
                            if let Some(response) = &mut final_response {
                                process_content_block_start(&chunk, response);
                            }
                        }
                        ChunkType::ContentBlockDelta => {
                            if let (Some(delta), Some(response)) =
                                (&chunk.delta, &mut final_response)
                            {
                                process_content_block_delta(delta, response);
                            }
                        }
                        ChunkType::MessageDelta => {
                            if let (Some(delta), Some(response)) =
                                (&chunk.delta, &mut final_response)
                            {
                                process_message_delta(delta, response);
                            }
                        }
                        ChunkType::ContentBlockStop => {
                            if let Some(response) = &mut final_response {
                                response.finalize_tool_use_block();
                            }
                        }
                        _ => {}
                    }
                    chunks.push(chunk);
                }
                Err(e) => {
                    log::error!("Failed to parse streaming chunk: {} - {:?}", data, e);
                }
            }
        }
    }

    Ok((chunks, final_response))
}
