//! Builds without native pages have no passkeys and nothing to import into.

use gpui::{AnyElement, Context, Window};
use serde_json::Value;

use crate::{host::HostRef, page::BrowserPage};

#[derive(Default)]
pub struct PageProfile;

impl PageProfile {
    pub const AVAILABLE: bool = false;

    pub fn is_open(&self) -> bool {
        false
    }

    #[allow(clippy::too_many_arguments)]
    pub fn passkey_request(&mut self, _: &HostRef, _: u64, _: bool, _: &str, _: &Value, _: &mut Window, _: &mut Context<BrowserPage>) {}

    pub fn passkey_cancel(&mut self, _: Option<u64>, _: &mut Window, _: &mut Context<BrowserPage>) {}

    pub fn open_import(&mut self, _: &HostRef, _: &mut Window, _: &mut Context<BrowserPage>) {}

    pub fn open_passkeys(&mut self, _: &mut Window, _: &mut Context<BrowserPage>) {}

    pub fn render(&self, _: &mut Context<BrowserPage>) -> Option<AnyElement> {
        None
    }
}
