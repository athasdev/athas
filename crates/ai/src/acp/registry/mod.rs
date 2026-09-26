//! The ACP Registry (https://agentclientprotocol.com/registry): the public list of ACP agents
//! and how to install each one.

pub mod archive;
pub mod catalog;
pub mod install;
pub mod schema;
pub mod store;

pub use schema::{
   RegistryAgent, ResolvedDistribution, current_registry_platform, resolve_distribution,
};
pub use store::{RegistrySnapshot, RegistryStore};

/// The user's `uvx`, which runs registry agents published as Python packages.
pub fn find_uvx() -> Option<std::path::PathBuf> {
   crate::executable_path::find_executable("uvx")
}
