//! The open SSH connections, one session (and SFTP channel, when the connection uses SFTP) each, shared by the file tree, the
//! editor, git and terminals. A dropped connection is opened again the next time it is used.
//! Backends call [`manager()`] from any thread; the workbench reaches the same manager through the
//! [`RemoteConnections`] global.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, OnceLock},
};

use anyhow::{Result, anyhow};
use ssh2::{Session, Sftp};

use crate::{
    connections::{self, Access, SavedConnection},
    session::{self, ExecOutput, ProxyProcess, Target},
};

pub struct ConnectionManager {
    open: Mutex<HashMap<String, Arc<Connection>>>,
}

/// The manager as a gpui global, so views can reach it from `cx`.
pub struct RemoteConnections(pub Arc<ConnectionManager>);

impl gpui::Global for RemoteConnections {}

pub fn manager() -> &'static Arc<ConnectionManager> {
    static MANAGER: OnceLock<Arc<ConnectionManager>> = OnceLock::new();
    MANAGER.get_or_init(|| Arc::new(ConnectionManager { open: Mutex::new(HashMap::new()) }))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl ConnectionManager {
    /// Connects (blocking) and keeps the connection. `password` is held in memory for reconnects
    /// and terminals; it reaches the keychain only when the connection says to remember it.
    pub fn connect(&self, saved: SavedConnection, password: Option<String>) -> Result<Arc<Connection>> {
        let password = password.or_else(|| saved.remember_password.then(|| connections::load_password(&saved.id)).flatten());
        let target = Target::resolve(&saved);
        let connection = Arc::new(Connection {
            target,
            password: Mutex::new(password.clone()),
            live: Mutex::new(None),
            saved,
        });
        connection.ensure_live()?;
        if let Some(password) = password.filter(|_| connection.saved.remember_password) {
            // The connection works; a keychain that refuses the password (no secret service on
            // Linux) only means it is asked for again next time.
            if let Err(error) = connections::store_password(&connection.saved.id, &password) {
                eprintln!("remote: could not remember the password: {error:#}");
            }
        }
        if let Some(previous) = lock(&self.open).insert(connection.saved.id.clone(), connection.clone()) {
            previous.disconnect();
        }
        Ok(connection)
    }

    /// Records the user's approval of a server key, then the caller connects again.
    pub fn trust(&self, saved: &SavedConnection, fingerprint: &str) -> Result<()> {
        session::trust(&Target::resolve(saved), fingerprint)
    }

    pub fn get(&self, id: &str) -> Option<Arc<Connection>> {
        lock(&self.open).get(id).cloned()
    }

    /// The open connection, or a new one for a saved connection that needs no prompt (agent, key,
    /// or a password in the keychain), as a project restored at start needs.
    pub fn get_or_connect(&self, id: &str) -> Result<Arc<Connection>> {
        if let Some(connection) = self.get(id) {
            return Ok(connection);
        }
        let saved = connections::load_default()
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| anyhow!("No saved remote connection {id}"))?;
        let name = saved.name.clone();
        self.connect(saved, None)
            .map_err(|error| anyhow!("Not connected to {name}: {}. Connect from Remote Connections.", session::friendly_error(&error)))
    }

    pub fn connected_ids(&self) -> Vec<String> {
        lock(&self.open).iter().filter(|(_, connection)| connection.is_connected()).map(|(id, _)| id.clone()).collect()
    }

    pub fn disconnect(&self, id: &str) {
        if let Some(connection) = lock(&self.open).remove(id) {
            connection.disconnect();
        }
    }
}

struct Live {
    session: Session,
    sftp: Option<Sftp>,
    _proxy: Option<ProxyProcess>,
}

pub struct Connection {
    pub saved: SavedConnection,
    target: Target,
    password: Mutex<Option<String>>,
    /// One session at a time: libssh2 sessions are not safe to use from two threads at once.
    live: Mutex<Option<Live>>,
}

impl Connection {
    pub fn target(&self) -> &Target {
        &self.target
    }

    pub fn is_connected(&self) -> bool {
        lock(&self.live).is_some()
    }

    fn open(&self) -> Result<Live> {
        let password = lock(&self.password).clone();
        let connected = session::connect(&self.target, password.as_deref())?;
        let sftp = match self.saved.access {
            Access::Sftp => Some(connected.session.sftp().map_err(|error| anyhow!("Failed to start SFTP: {error}"))?),
            Access::Ssh => None,
        };
        Ok(Live { session: connected.session, sftp, _proxy: connected.proxy })
    }

    fn ensure_live(&self) -> Result<()> {
        let mut live = lock(&self.live);
        if live.is_none() {
            *live = Some(self.open()?);
        }
        Ok(())
    }

    /// Whether files go through SFTP; otherwise through shell commands ([`crate::shell_files`]).
    pub fn uses_sftp(&self) -> bool {
        self.saved.access == Access::Sftp
    }

    /// Runs `work` on the session; when it fails because the connection dropped, connects again
    /// and runs it once more.
    fn with_live<T>(&self, work: impl Fn(&Live) -> Result<T>) -> Result<T> {
        let mut live = lock(&self.live);
        if live.is_none() {
            *live = Some(self.open()?);
        }
        let current = live.as_ref().expect("connected above");
        match work(current) {
            Ok(value) => Ok(value),
            Err(error) if current.session.keepalive_send().is_ok() => Err(error),
            Err(_) => {
                *live = None;
                let reopened = live.insert(self.open()?);
                work(reopened)
            }
        }
    }

    /// Runs `work` with the session and its SFTP channel; fails on a connection without SFTP.
    pub fn with_session<T>(&self, work: impl Fn(&Session, &Sftp) -> Result<T>) -> Result<T> {
        self.with_live(|live| match &live.sftp {
            Some(sftp) => work(&live.session, sftp),
            None => Err(anyhow!("{} has no SFTP access", self.saved.name)),
        })
    }

    pub fn exec(&self, command: &str, stdin: Option<&[u8]>) -> Result<ExecOutput> {
        self.with_live(|live| session::exec(&live.session, command, stdin))
    }

    /// A second, independent session, for a terminal that streams without holding this one.
    pub fn open_session(&self) -> Result<(Session, Option<ProxyProcess>)> {
        let password = lock(&self.password).clone();
        let connected = session::connect(&self.target, password.as_deref())?;
        Ok((connected.session, connected.proxy))
    }

    /// The remote user's home folder, where the folder browser starts.
    pub fn home_dir(&self) -> Result<String> {
        if !self.uses_sftp() {
            return crate::shell_files::home(&|command, stdin| self.exec(command, stdin));
        }
        self.with_session(|_, sftp| Ok(sftp.realpath(std::path::Path::new("."))?.to_string_lossy().into_owned()))
    }

    fn disconnect(&self) {
        if let Some(live) = lock(&self.live).take() {
            drop(live.sftp);
            live.session.disconnect(None, "Disconnecting", None).ok();
        }
    }
}
