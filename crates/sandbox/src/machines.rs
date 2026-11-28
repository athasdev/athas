//! The user's own machines as sandboxes: a desktop in the next room, a build server, a VM. They
//! are the one environment Athas does not make and must never destroy, which is the whole reason
//! they are not just another [`Provider`] in [`crate::providers`].
//!
//! The connections themselves live in `crates/remote` -- saved hosts, known-hosts trust, keys and
//! passwords in the keychain -- and that crate draws windows, so this crate cannot depend on it.
//! It registers itself here instead, the way the agent host registers its remote agents, and
//! everything that asks for an environment asks this module without knowing who answered.

use std::sync::{Arc, OnceLock};

use crate::{Error, Provider, Result};

/// A machine the user has already saved, as the Environment menu shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Machine {
    /// The saved connection's id.
    pub id: String,
    pub name: String,
    /// `user@host:port`, for the second line of a row.
    pub location: String,
    /// Whether Athas is connected to it right now. A machine that is not is not unavailable:
    /// choosing it connects.
    pub connected: bool,
}

impl Machine {
    /// The provider id this machine answers to (`machine:<id>`).
    pub fn provider_id(&self) -> String {
        format!("{}{}", crate::providers::MACHINE_PREFIX, self.id)
    }
}

/// What `crates/remote` installs so the rest of Athas can reach a saved machine.
pub trait Machines: Send + Sync {
    fn list(&self) -> Vec<Machine>;
    /// A client for one saved machine. Connects if Athas is not connected yet, which is why this
    /// blocks and why it can fail with something worth showing the user.
    fn provider(&self, machine: &str) -> Result<Box<dyn Provider>>;
}

static SOURCE: OnceLock<Arc<dyn Machines>> = OnceLock::new();

/// Installed once, at startup, by whoever owns the saved connections.
pub fn set_source(machines: Arc<dyn Machines>) {
    let _ = SOURCE.set(machines);
}

/// Every machine that could run a session's commands. Empty in a build that never installed a
/// source -- the web build, the snapshot tools -- which reads as "no machines", not as an error.
pub fn list() -> Vec<Machine> {
    SOURCE.get().map(|source| source.list()).unwrap_or_default()
}

/// The client for a `machine:<id>` provider id.
pub fn provider(provider_id: &str) -> Result<Box<dyn Provider>> {
    let id = crate::providers::machine_id(provider_id)
        .ok_or_else(|| Error::unavailable(format!("{provider_id} is not a machine.")))?;
    let source = SOURCE.get().ok_or_else(|| Error::unavailable("This build of Athas cannot connect to machines."))?;
    source.provider(id)
}

/// The machine behind a provider id, when it is one Athas still knows about. A session saved
/// against a connection the user has since deleted finds nothing here.
pub fn find(provider_id: &str) -> Option<Machine> {
    let id = crate::providers::machine_id(provider_id)?;
    list().into_iter().find(|machine| machine.id == id)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_machines_provider_id_round_trips_through_its_saved_id() {
        let machine = super::Machine { id: "ssh-build".into(), name: "Build box".into(), location: "me@build:22".into(), connected: false };
        assert_eq!(machine.provider_id(), "machine:ssh-build");
        assert_eq!(crate::providers::machine_id(&machine.provider_id()), Some("ssh-build"));
    }

    #[test]
    fn a_build_with_no_machines_installed_has_none_rather_than_failing() {
        assert!(super::list().is_empty());
        assert!(super::provider("machine:whatever").is_err());
        assert!(super::find("machine:whatever").is_none());
    }
}
