use crate::types::{ParsedResponse, StreamingChunk};
use anyhow::{Result, bail};

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
                    // Build final response from message_start and content_blocks
                    if chunk.chunk_type == "message_start" {
                        if let Some(ref message) = chunk.message {
                            final_response = Some(ParsedResponse {
                                id: Some(message.id.clone()),
                                response_type: Some(message.message_type.clone()),
                                role: Some(message.role.clone()),
                                model: Some(message.model.clone()),
                                content: Some(Vec::new()),
                                usage: Some(message.usage.clone()),
                                stop_reason: None,
                                stop_sequence: None,
                                error: None,
                            });
                        }
                    }

                    if chunk.chunk_type == "content_block_start" {
                        if let (Some(content_block), Some(response)) =
                            (&chunk.content_block, &mut final_response)
                        {
                            if let Some(content) = &mut response.content {
                                content.push(content_block.clone());
                            }
                        }
                    }

                    if chunk.chunk_type == "content_block_delta" {
                        if let (Some(delta), Some(response)) = (&chunk.delta, &mut final_response) {
                            if let (Some(text), Some(content)) =
                                (&delta.text, &mut response.content)
                            {
                                if let Some(last_block) = content.last_mut() {
                                    if last_block.content_type == "text" {
                                        if let Some(ref mut block_text) = last_block.text {
                                            block_text.push_str(text);
                                        } else {
                                            last_block.text = Some(text.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if chunk.chunk_type == "message_delta" {
                        if let (Some(delta), Some(response)) = (&chunk.delta, &mut final_response) {
                            if let Some(stop_reason) = &delta.stop_reason {
                                response.stop_reason = Some(stop_reason.clone());
                            }
                            response.stop_sequence = delta.stop_sequence.clone();
                        }
                    }

                    chunks.push(chunk);
                }
                Err(e) => {
                    tracing::error!("Failed to parse streaming chunk: {} - {:?}", data, e);
                }
            }
        }
    }

    Ok((chunks, final_response))
}

pub fn parse_non_streaming_response(response_text: &str) -> Result<ParsedResponse> {
    match serde_json::from_str(response_text) {
        Ok(response) => Ok(response),
        Err(e) => {
            bail!("Failed to parse response: {}", e)
        }
    }
}
