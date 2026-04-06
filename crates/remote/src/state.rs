use ssh2::{Channel, Session, Sftp};
use std::{
   collections::HashMap,
   sync::{Arc, Mutex},
};

pub(super) type ConnectionStorage = Arc<Mutex<HashMap<String, (Session, Option<Sftp>)>>>;
pub(super) type RemoteTerminalStorage = Arc<Mutex<HashMap<String, RemoteTerminal>>>;

lazy_static::lazy_static! {
    pub(super) static ref CONNECTIONS: ConnectionStorage = Arc::new(Mutex::new(HashMap::new()));
    pub(super) static ref REMOTE_TERMINALS: RemoteTerminalStorage = Arc::new(Mutex::new(HashMap::new()));
}

pub(super) struct RemoteTerminal {
   pub _session: Arc<Mutex<Session>>,
   pub channel: Arc<Mutex<Channel>>,
}
