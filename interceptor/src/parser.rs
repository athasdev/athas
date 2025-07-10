use crate::types::{ChunkType, ContentBlock, Delta, ParsedResponse, StreamingChunk};
use anyhow::{Context, Result};
use thin_logger::log;

impl ParsedResponse {
    fn append_content_block(&mut self, block: ContentBlock) {
        self.content.get_or_insert_with(Vec::new).push(block);
    }

    fn append_text_to_last_block(&mut self, text: &str) {
        if let Some(content) = &mut self.content {
            if let Some(last_block) = content.last_mut() {
                if last_block.content_type == "text" {
                    match &mut last_block.text {
                        Some(existing_text) => existing_text.push_str(text),
                        None => last_block.text = Some(text.to_string()),
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
    chunk.message.as_ref().map(|message| {
        ParsedResponse::builder()
            .id(message.id.clone())
            .response_type(message.message_type.clone())
            .role(message.role.clone())
            .model(message.model.clone())
            .content(Vec::new())
            .usage(message.usage.clone())
            .build()
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

pub fn parse_non_streaming_response(response_text: &str) -> Result<ParsedResponse> {
    serde_json::from_str(response_text).context("Failed to parse response")
}
