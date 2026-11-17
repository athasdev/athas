//! The model providers Athas talks to and the models it offers for each.
//!
//! Ported from Athas's `features/ai/types/providers.types.ts` and
//! `services/providers/ai-provider-registry.ts`. Every provider speaks one of two wire formats:
//! Anthropic's Messages API, or OpenAI's chat completions (which covers OpenAI, OpenRouter, xAI,
//! Mistral, DeepSeek, Qwen, Gemini's OpenAI endpoint, Vercel's gateway, Ollama, a custom endpoint
//! and Athas's own hosted models).

/// The site Athas's account and hosted models live on; `ATHAS_API_BASE` points elsewhere.
pub const DEFAULT_API_BASE: &str = "https://athas.dev";

pub fn api_base() -> String {
    std::env::var("ATHAS_API_BASE")
        .ok()
        .map(|base| base.trim().trim_end_matches('/').to_string())
        .filter(|base| !base.is_empty())
        .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireFormat {
    Anthropic,
    OpenAi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Model {
    pub id: &'static str,
    pub name: &'static str,
    /// Tokens the model reads at once; 0 when unknown.
    pub context_window: u64,
    pub max_output_tokens: u64,
    pub supports_images: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub format: WireFormat,
    /// Where requests go; empty for a provider whose endpoint comes from settings.
    pub url: &'static str,
    pub requires_api_key: bool,
    /// Environment variables an API key is read from when none is saved.
    pub key_env: &'static [&'static str],
    /// Where to create a key.
    pub key_url: Option<&'static str>,
    pub models: &'static [Model],
}

impl Provider {
    pub fn model(&self, id: &str) -> Option<&'static Model> {
        self.models.iter().find(|model| model.id == id)
    }

    pub fn is_hosted(&self) -> bool {
        self.id == ATHAS
    }
}

pub const ATHAS: &str = "athas";
pub const CUSTOM: &str = "custom";
pub const OLLAMA: &str = "ollama";

const fn model(id: &'static str, name: &'static str, context_window: u64, max_output_tokens: u64) -> Model {
    Model { id, name, context_window, max_output_tokens, supports_images: true }
}

const fn text_model(id: &'static str, name: &'static str, context_window: u64, max_output_tokens: u64) -> Model {
    Model { id, name, context_window, max_output_tokens, supports_images: false }
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: ATHAS,
        name: "Athas",
        format: WireFormat::OpenAi,
        url: "/api/ai/chat/completions",
        requires_api_key: false,
        key_env: &[],
        key_url: None,
        // Shown until the server's catalog arrives. `auto` runs on a steady-priced model that reads images.
        models: &[
            model("auto", "Automatic", 200_000, 32_000),
            model("anthropic/claude-opus-5.5", "Claude Opus 5.5", 1_000_000, 32_000),
            model("anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5", 1_000_000, 32_000),
            model("anthropic/claude-sonnet-5", "Claude Sonnet 5", 1_000_000, 32_000),
            model("openai/gpt-5.4", "GPT 5.4", 400_000, 32_000),
            model("google/gemini-3.1-pro", "Gemini 3.1 Pro", 1_048_576, 32_000),
            model("moonshotai/kimi-k3", "Kimi K3", 256_000, 32_000),
            model("alibaba/qwen3.8-max", "Qwen 3.8 Max", 1_000_000, 32_000),
            text_model("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", 1_000_000, 32_000),
            model("google/gemini-3.8-flash", "Gemini 3.8 Flash", 1_048_576, 32_000),
            model("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", 200_000, 32_000),
            text_model("minimax/m3", "MiniMax M3", 1_000_000, 32_000),
        ],
    },
    Provider {
        id: "anthropic",
        name: "Anthropic",
        format: WireFormat::Anthropic,
        url: "https://api.anthropic.com/v1/messages",
        requires_api_key: true,
        key_env: &["ANTHROPIC_API_KEY"],
        key_url: Some("https://console.anthropic.com/settings/keys"),
        models: &[
            model("claude-fable-5-1", "Claude Fable 5.1", 1_000_000, 128_000),
            model("claude-opus-5-5", "Claude Opus 5.5", 1_000_000, 128_000),
            model("claude-opus-5", "Claude Opus 5", 1_000_000, 128_000),
            model("claude-sonnet-5", "Claude Sonnet 5", 1_000_000, 128_000),
            model("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, 64_000),
        ],
    },
    Provider {
        id: "openai",
        name: "OpenAI",
        format: WireFormat::OpenAi,
        url: "https://api.openai.com/v1/chat/completions",
        requires_api_key: true,
        key_env: &["OPENAI_API_KEY"],
        key_url: Some("https://platform.openai.com/api-keys"),
        models: &[
            model("gpt-5.6-sol", "GPT-5.6 Sol", 1_050_000, 128_000),
            model("gpt-5.6-terra", "GPT-5.6 Terra", 1_050_000, 128_000),
            model("gpt-5.6-luna", "GPT-5.6 Luna", 1_050_000, 128_000),
        ],
    },
    Provider {
        id: "gemini",
        name: "Google Gemini",
        format: WireFormat::OpenAi,
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        requires_api_key: true,
        key_env: &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        key_url: Some("https://aistudio.google.com/app/apikey"),
        models: &[
            model("gemini-3.7-flash", "Gemini 3.7 Flash", 1_048_576, 65_536),
            model("gemini-3.6-flash", "Gemini 3.6 Flash", 1_048_576, 65_536),
            model("gemini-3.5-flash", "Gemini 3.5 Flash", 1_048_576, 65_536),
            model("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", 1_048_576, 65_536),
            model("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", 1_048_576, 65_536),
        ],
    },
    Provider {
        id: "grok",
        name: "xAI Grok",
        format: WireFormat::OpenAi,
        url: "https://api.x.ai/v1/chat/completions",
        requires_api_key: true,
        key_env: &["XAI_API_KEY"],
        key_url: Some("https://console.x.ai"),
        models: &[model("grok-4.6", "Grok 4.6", 500_000, 131_072), model("grok-build-0.1", "Grok Build 0.1", 256_000, 131_072)],
    },
    Provider {
        id: "deepseek",
        name: "DeepSeek",
        format: WireFormat::OpenAi,
        url: "https://api.deepseek.com/chat/completions",
        requires_api_key: true,
        key_env: &["DEEPSEEK_API_KEY"],
        key_url: None,
        models: &[
            text_model("deepseek-v4-flash", "DeepSeek V4 Flash", 1_000_000, 384_000),
            text_model("deepseek-v4-pro", "DeepSeek V4 Pro", 1_000_000, 384_000),
        ],
    },
    Provider {
        id: "mistral",
        name: "Mistral AI",
        format: WireFormat::OpenAi,
        url: "https://api.mistral.ai/v1/chat/completions",
        requires_api_key: true,
        key_env: &["MISTRAL_API_KEY"],
        key_url: Some("https://console.mistral.ai/api-keys"),
        models: &[
            model("mistral-medium-3-5", "Mistral Medium 3.5", 262_144, 131_072),
            model("mistral-small-2603", "Mistral Small 4", 262_144, 131_072),
            model("mistral-large-2512", "Mistral Large 3", 262_144, 131_072),
            text_model("codestral-2508", "Codestral", 128_000, 65_536),
        ],
    },
    Provider {
        id: "qwen",
        name: "Qwen",
        format: WireFormat::OpenAi,
        url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        requires_api_key: true,
        key_env: &["DASHSCOPE_API_KEY"],
        key_url: None,
        models: &[
            model("qwen3.8-max", "Qwen 3.8 Max", 1_000_000, 131_072),
            model("qwen3.8-flash", "Qwen 3.8 Flash", 1_000_000, 131_072),
            model("qwen3.7-plus", "Qwen 3.7 Plus", 1_000_000, 65_536),
            model("qwen3.7-flash", "Qwen 3.7 Flash", 1_000_000, 65_536),
        ],
    },
    Provider {
        id: "openrouter",
        name: "OpenRouter",
        format: WireFormat::OpenAi,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requires_api_key: true,
        key_env: &["OPENROUTER_API_KEY"],
        key_url: Some("https://openrouter.ai/keys"),
        models: &[],
    },
    Provider {
        id: "vercel",
        name: "Vercel AI Gateway",
        format: WireFormat::OpenAi,
        url: "https://ai-gateway.vercel.sh/v1/chat/completions",
        requires_api_key: true,
        key_env: &["AI_GATEWAY_API_KEY"],
        key_url: Some("https://vercel.com/dashboard/ai-gateway"),
        models: &[],
    },
    Provider {
        id: OLLAMA,
        name: "Ollama",
        format: WireFormat::OpenAi,
        url: "",
        requires_api_key: false,
        key_env: &["OLLAMA_API_KEY"],
        key_url: None,
        models: &[],
    },
    Provider {
        id: CUSTOM,
        name: "Custom",
        format: WireFormat::OpenAi,
        url: "",
        requires_api_key: false,
        key_env: &[],
        key_url: None,
        models: &[],
    },
];

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|provider| provider.id == id)
}

/// Ollama's address from the `ollamaBaseUrl` setting, without a trailing `/v1` or slash.
/// A bare host such as `192.168.1.20:8080` gets `http://`; anything but http(s), or an address
/// with a query or fragment, falls back to the default (`normalizeOllamaBaseUrl`).
pub fn normalize_ollama_base_url(value: &str) -> String {
    const DEFAULT: &str = "http://localhost:11434";
    let trimmed = value.trim().trim_end_matches('/');
    let trimmed = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    if trimmed.is_empty() || trimmed.contains(['?', '#']) {
        return DEFAULT.to_string();
    }
    match trimmed.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") => {
            if rest.is_empty() { DEFAULT.to_string() } else { trimmed.to_string() }
        }
        Some(_) => DEFAULT.to_string(),
        None => format!("http://{trimmed}"),
    }
}

/// A chat completions URL from a custom base URL: `https://host/v1` gets `/chat/completions`.
pub fn chat_completions_url(base: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") { base.to_string() } else { format!("{base}/chat/completions") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_has_a_unique_id_and_a_wire_format() {
        let mut ids: Vec<_> = PROVIDERS.iter().map(|provider| provider.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), PROVIDERS.len());
        assert_eq!(provider("anthropic").unwrap().format, WireFormat::Anthropic);
        assert_eq!(provider("gemini").unwrap().format, WireFormat::OpenAi);
        assert!(provider(ATHAS).unwrap().is_hosted());
        assert_eq!(provider("anthropic").unwrap().model("claude-haiku-4-5").unwrap().context_window, 200_000);
    }

    #[test]
    fn endpoints_from_settings_are_normalized() {
        assert_eq!(normalize_ollama_base_url("http://box:11434/v1/"), "http://box:11434");
        assert_eq!(normalize_ollama_base_url(" "), "http://localhost:11434");
        assert_eq!(normalize_ollama_base_url("192.168.1.20:8080/"), "http://192.168.1.20:8080");
        assert_eq!(normalize_ollama_base_url("ftp://box"), "http://localhost:11434");
        assert_eq!(chat_completions_url("https://llm.local/v1/"), "https://llm.local/v1/chat/completions");
        assert_eq!(chat_completions_url("https://llm.local/v1/chat/completions"), "https://llm.local/v1/chat/completions");
    }
}
