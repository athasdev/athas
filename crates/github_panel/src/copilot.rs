//! The signed-in account's Copilot allowance, fetched with the panel's own token.
//!
//! The web build has no `gh` CLI and no local token, and the relay does not proxy the endpoint,
//! so it reports nothing rather than guessing.

#[cfg(not(target_family = "wasm"))]
pub use crate::gh::{CopilotAllowance, CopilotQuota};
use gpui::{App, Task, prelude::*};

/// Asks GitHub what is left of this month's Copilot allowance. `None` without a token.
#[cfg(not(target_family = "wasm"))]
pub fn allowance(cx: &mut App) -> Option<Task<Option<CopilotAllowance>>> {
    let token = crate::store::auth(cx)?.token()?;
    Some(cx.background_spawn(async move { crate::gh::github_copilot_allowance(Some(token)) }))
}

/// The web build's stand-in: an allowance that is never known.
#[cfg(target_family = "wasm")]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CopilotQuota {
    pub unlimited: bool,
    pub remaining: i64,
    pub entitlement: i64,
    pub percent_remaining: f64,
}

#[cfg(target_family = "wasm")]
impl CopilotQuota {
    pub fn is_metered(&self) -> bool {
        !self.unlimited && self.entitlement > 0
    }

    pub fn used_fraction(&self) -> f32 {
        if self.entitlement <= 0 {
            return 0.;
        }
        ((self.entitlement - self.remaining).max(0) as f32 / self.entitlement as f32).clamp(0., 1.)
    }
}

#[cfg(target_family = "wasm")]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CopilotAllowance {
    pub plan: Option<String>,
    pub premium: Option<CopilotQuota>,
    pub resets_on: Option<String>,
}

#[cfg(target_family = "wasm")]
pub fn allowance(_: &mut App) -> Option<Task<Option<CopilotAllowance>>> {
    None
}
