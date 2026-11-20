//! Content-free signals: friction (`services/friction-signals.ts`) and AI failures
//! (`services/ai-signals.ts`). Their payloads carry enums, buckets and checked identifiers only,
//! never prompts, paths, messages or server error text.

use std::{sync::LazyLock, time::Duration};

use regex::Regex;
use serde_json::{Map, Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrictionArea {
    Startup,
    Agent,
    Navigation,
    Layout,
    Extensions,
    Feedback,
    Terminal,
}

impl FrictionArea {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::Agent => "agent",
            Self::Navigation => "navigation",
            Self::Layout => "layout",
            Self::Extensions => "extensions",
            Self::Feedback => "feedback",
            Self::Terminal => "terminal",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrictionKind {
    SlowReady,
    Retry,
    Cancel,
    QueueDiscard,
    RestoreFailed,
    PromptDismissed,
    Opened,
    Submitted,
    RendererFallback,
}

impl FrictionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SlowReady => "slow_ready",
            Self::Retry => "retry",
            Self::Cancel => "cancel",
            Self::QueueDiscard => "queue_discard",
            Self::RestoreFailed => "restore_failed",
            Self::PromptDismissed => "prompt_dismissed",
            Self::Opened => "opened",
            Self::Submitted => "submitted",
            Self::RendererFallback => "renderer_fallback",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DurationBucket {
    Under1s,
    From1To5s,
    From5To30s,
    From30To120s,
    Over120s,
}

impl DurationBucket {
    pub fn of(duration: Duration) -> Self {
        match duration.as_millis() {
            0..1_000 => Self::Under1s,
            1_000..5_000 => Self::From1To5s,
            5_000..30_000 => Self::From5To30s,
            30_000..120_000 => Self::From30To120s,
            _ => Self::Over120s,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Under1s => "under_1s",
            Self::From1To5s => "1_to_5s",
            Self::From5To30s => "5_to_30s",
            Self::From30To120s => "30_to_120s",
            Self::Over120s => "over_120s",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrictionSignal {
    pub area: FrictionArea,
    pub kind: FrictionKind,
    pub duration: Option<DurationBucket>,
    pub count: Option<u32>,
}

impl FrictionSignal {
    pub fn new(area: FrictionArea, kind: FrictionKind) -> Self {
        Self { area, kind, duration: None, count: None }
    }

    /// The name the local log and the feedback environment count it under.
    pub fn log_name(&self) -> String {
        format!("friction:{}:{}", self.area.as_str(), self.kind.as_str())
    }

    pub fn payload(&self) -> Map<String, Value> {
        let mut payload = Map::new();
        payload.insert("area".into(), self.area.as_str().into());
        payload.insert("signal".into(), self.kind.as_str().into());
        if let Some(bucket) = self.duration {
            payload.insert("duration_bucket".into(), bucket.as_str().into());
        }
        if let Some(count) = self.count {
            payload.insert("count".into(), count.clamp(1, 99).into());
        }
        payload
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiRunKind {
    Builtin,
    Acp,
    Codex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiFailurePhase {
    Context,
    Provider,
    Stream,
    EmptyResponse,
}

/// An AI run that failed: which provider, model and phase, and how, but no content.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AiFailure {
    pub kind: Option<AiRunKind>,
    pub provider_id: String,
    pub model_id: Option<String>,
    /// A short machine code such as `http_429`; free text is dropped.
    pub code: Option<String>,
    pub status: Option<u16>,
    pub phase: Option<AiFailurePhase>,
    pub step_count: Option<u32>,
    pub retried: bool,
    pub cancelled: bool,
}

static IDENTIFIER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$").expect("identifier pattern"));
static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_]{1,40}$").expect("code pattern"));

/// An identifier kept only when it looks like one, so free text can never slip through.
fn identifier(value: Option<&str>) -> Value {
    value.map(str::trim).filter(|value| IDENTIFIER.is_match(value)).map_or(Value::Null, Value::from)
}

impl AiFailure {
    pub fn log_name(&self) -> String {
        format!("ai_failure:{}:{}", self.kind_str(), self.phase_str())
    }

    fn kind_str(&self) -> &'static str {
        match self.kind {
            Some(AiRunKind::Builtin) | None => "builtin",
            Some(AiRunKind::Acp) => "acp",
            Some(AiRunKind::Codex) => "codex",
        }
    }

    fn phase_str(&self) -> &'static str {
        match self.phase {
            Some(AiFailurePhase::Context) => "context",
            Some(AiFailurePhase::Provider) | None => "provider",
            Some(AiFailurePhase::Stream) => "stream",
            Some(AiFailurePhase::EmptyResponse) => "empty_response",
        }
    }

    pub fn payload(&self) -> Map<String, Value> {
        let value = json!({
            "kind": self.kind_str(),
            "provider_id": identifier(Some(&self.provider_id)),
            // A custom endpoint's model name is whatever the user typed; leave it out.
            "model_id": if self.provider_id == "custom" { Value::Null } else { identifier(self.model_id.as_deref()) },
            "code": self.code.as_deref().filter(|code| CODE.is_match(code)).map_or(Value::Null, Value::from),
            "status": self.status.filter(|status| (100..600).contains(status)).map_or(Value::Null, Value::from),
            "phase": self.phase_str(),
            "step_count": self.step_count.map_or(Value::Null, |count| count.min(99).into()),
            "retried": self.retried,
            "cancelled": self.cancelled,
        });
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friction_payloads_carry_buckets_and_clamped_counts() {
        let signal = FrictionSignal {
            area: FrictionArea::Agent,
            kind: FrictionKind::Retry,
            duration: Some(DurationBucket::of(Duration::from_secs(7))),
            count: Some(500),
        };
        assert_eq!(
            Value::Object(signal.payload()),
            json!({ "area": "agent", "signal": "retry", "duration_bucket": "5_to_30s", "count": 99 })
        );
        assert_eq!(signal.log_name(), "friction:agent:retry");
        assert_eq!(DurationBucket::of(Duration::from_millis(999)), DurationBucket::Under1s);
        assert_eq!(DurationBucket::of(Duration::from_secs(600)), DurationBucket::Over120s);
    }

    #[test]
    fn ai_failures_drop_free_text() {
        let failure = AiFailure {
            kind: Some(AiRunKind::Acp),
            provider_id: "anthropic".into(),
            model_id: Some("please summarise /Users/alex/secret.txt".into()),
            code: Some("rate limited, try later".into()),
            status: Some(429),
            phase: Some(AiFailurePhase::Stream),
            step_count: Some(150),
            ..Default::default()
        };
        let payload = Value::Object(failure.payload());
        assert_eq!(payload["provider_id"], "anthropic");
        assert_eq!(payload["model_id"], Value::Null);
        assert_eq!(payload["code"], Value::Null);
        assert_eq!(payload["status"], 429);
        assert_eq!(payload["step_count"], 99);
        let custom = AiFailure { provider_id: "custom".into(), model_id: Some("my-model".into()), ..Default::default() };
        assert_eq!(Value::Object(custom.payload())["model_id"], Value::Null);
    }
}
