//! Which client a provider id means, and what it needs before it can be made.
//!
//! Every caller used to answer this with a `match` of its own -- the agent's runtime had two and
//! the catalog's page a third -- so a provider was added in three places or it half worked. This
//! is the one place: a provider is added here, and the agent, the catalog and the Environment
//! menu all know it at once.
//!
//! The id is the manifest's (`sandboxProviders[].id`), except for a machine, whose id carries the
//! saved connection it stands for ([`MACHINE_PREFIX`]).

use crate::{Provider, Result};

/// What a provider wants before a client can be made for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Auth {
    /// Nothing: it runs on this machine (Docker).
    None,
    /// An API key, kept in the keychain under `sandbox_<id>`.
    ApiKey,
    /// A saved SSH connection, with whatever that connection already authenticates with.
    Machine,
}

/// A machine provider's id is `machine:<saved connection id>`: one provider per machine, because
/// each is reached with its own credentials and none of them is interchangeable with another.
pub const MACHINE_PREFIX: &str = "machine:";

/// The saved connection a machine provider id names.
pub fn machine_id(provider: &str) -> Option<&str> {
    provider.strip_prefix(MACHINE_PREFIX)
}

/// Whether this build can make a client for `provider` at all. A manifest is free to name a
/// provider this build has never heard of; the catalog shows it and nothing can run in it.
pub fn is_known(provider: &str) -> bool {
    auth(provider).is_some()
}

/// What `provider` wants, or `None` when this build has no client for it.
pub fn auth(provider: &str) -> Option<Auth> {
    if machine_id(provider).is_some() {
        return Some(Auth::Machine);
    }
    match provider {
        crate::docker::ID => Some(Auth::None),
        crate::e2b::ID | crate::daytona::ID | crate::boat::ID => Some(Auth::ApiKey),
        _ => None,
    }
}

/// A client made from a key the caller already has, for checking a key before it is saved. Only
/// ever answers for the providers that take a key: the others have nothing to check.
pub fn with_key(provider: &str, key: &str) -> Option<Box<dyn Provider>> {
    match provider {
        crate::e2b::ID => Some(Box::new(crate::e2b::E2b::new(key))),
        crate::daytona::ID => Some(Box::new(crate::daytona::Daytona::new(key))),
        crate::boat::ID => Some(Box::new(crate::boat::Boat::new(key))),
        _ => None,
    }
}

/// The client for `provider`, with whatever it authenticates with found here rather than by the
/// caller. The error is what to tell the user, in their words and not the protocol's.
pub fn connect(provider: &str) -> Result<Box<dyn Provider>> {
    match auth(provider) {
        Some(Auth::None) => Ok(Box::new(crate::docker::Docker::new())),
        Some(Auth::Machine) => crate::machines::provider(provider),
        Some(Auth::ApiKey) => {
            let key = crate::keys::get(provider)
                .ok_or_else(|| crate::Error::auth(format!("No key is saved for {provider}. Add one on its page in Integrations.")))?;
            with_key(provider, &key)
                .ok_or_else(|| crate::Error::unavailable(format!("This build of Athas has no client for {provider}.")))
        }
        None => Err(crate::Error::unavailable(format!("This build of Athas has no client for {provider}."))),
    }
}

/// Whether `provider` is ready to be used right now: its key is saved, its machine is known, or
/// it needs nothing. What the Environment menu greys a row out by.
pub fn is_ready(provider: &str) -> bool {
    match auth(provider) {
        Some(Auth::None) => true,
        Some(Auth::ApiKey) => crate::keys::get(provider).is_some(),
        Some(Auth::Machine) => crate::machines::list().iter().any(|machine| machine.provider_id() == provider),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_machine_id_carries_the_connection_it_stands_for() {
        assert_eq!(machine_id("machine:ssh-build-box"), Some("ssh-build-box"));
        assert_eq!(machine_id("e2b"), None);
        assert_eq!(auth("machine:anything"), Some(Auth::Machine));
    }

    #[test]
    fn docker_wants_nothing_and_the_hosted_providers_want_a_key() {
        assert_eq!(auth(crate::docker::ID), Some(Auth::None));
        assert_eq!(auth(crate::e2b::ID), Some(Auth::ApiKey));
        assert_eq!(auth(crate::daytona::ID), Some(Auth::ApiKey));
        assert_eq!(auth(crate::boat::ID), Some(Auth::ApiKey));
        // A provider a manifest names and this build has no client for.
        assert_eq!(auth("some-future-provider"), None);
        assert!(!is_known("some-future-provider"));
    }

    #[test]
    fn a_key_checked_before_it_is_saved_needs_no_keychain() {
        assert!(with_key(crate::daytona::ID, "dtn_1").is_some());
        assert!(with_key(crate::boat::ID, "boat_1").is_some());
        // Docker has no key to check, so there is nothing to make one from.
        assert!(with_key(crate::docker::ID, "").is_none());
    }
}
