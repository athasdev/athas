// Types for Claude Code integration via interceptor

export interface ClaudeStatus {
  running: boolean;
  connected: boolean;
  interceptor_running: boolean;
}

export interface InterceptorMessage {
  type: "request" | "response" | "stream_chunk" | "error";
  data?: InterceptedRequest;
  request_id?: string;
  chunk?: StreamingChunk;
  error?: string;
}

interface InterceptedRequest {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  parsed_request: ParsedRequest;
  raw_request: string;
  headers: Record<string, string>;
  parsed_response?: ParsedResponse;
  raw_response?: string;
  streaming_chunks?: StreamingChunk[];
  duration_ms?: number;
  error?: string;
}

interface ParsedRequest {
  model: string;
  messages: ParsedMessage[];
  system?: SystemPrompt;
  tools?: Tool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface ParsedMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface SystemPrompt {
  text?: string;
  blocks?: SystemBlock[];
}

interface SystemBlock {
  type: string;
  text: string;
}

interface ParsedResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: ContentBlock[];
  model?: string;
  stop_reason?: string;
  stop_sequence?: string;
  usage?: Usage;
  error?: ErrorResponse;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
}

interface ErrorResponse {
  type: string;
  message: string;
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  content?: string | ToolResultContent[];
  is_error?: boolean;
}

interface ToolResultContent {
  type: "text" | "image";
  text?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface Tool {
  name: string;
  description?: string;
  input_schema?: any;
}

interface StreamingChunk {
  type: string;
  index?: number;
  delta?: Delta;
  content_block?: ContentBlock;
  message?: StreamMessage;
  error?: ErrorResponse;
}

interface Delta {
  type?: string;
  text?: string;
  partial_json?: string;
  stop_reason?: string;
  stop_sequence?: string;
}

interface StreamMessage {
  id: string;
  type: string;
  role: string;
  model: string;
  stop_reason?: string;
  stop_sequence?: string;
  usage: Usage;
}
