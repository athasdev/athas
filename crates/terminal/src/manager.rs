use crate::{
   config::TerminalConfig,
   connection::TerminalConnection,
   protocol::{TerminalEventHandler, TerminalInput, TerminalSize},
};
use anyhow::{Result, anyhow};
use std::{
   collections::HashMap,
   sync::{Arc, Mutex},
};
use uuid::Uuid;

pub struct TerminalManager {
   connections: Arc<Mutex<HashMap<String, TerminalConnection>>>,
}

impl Default for TerminalManager {
   fn default() -> Self {
      Self::new()
   }
}

impl TerminalManager {
   pub fn new() -> Self {
      TerminalConnection::warm_user_environment();

      Self {
         connections: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub fn create_terminal(
      &self,
      config: TerminalConfig,
      event_handler: TerminalEventHandler,
   ) -> Result<String> {
      let id = Uuid::new_v4().to_string();
      let connection = TerminalConnection::new(id.clone(), config, event_handler)?;

      // Start the reader thread
      connection.start_reader_thread();

      // Store the connection
      let mut connections = self.connections.lock().unwrap();
      connections.insert(id.clone(), connection);

      Ok(id)
   }

   pub fn write_to_terminal(&self, id: &str, input: TerminalInput) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.write(&input.into_bytes())
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn resize_terminal(&self, id: &str, size: TerminalSize) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.resize(size)
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn set_terminal_paused(&self, id: &str, paused: bool) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.set_paused(paused);
         Ok(())
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn close_terminal(&self, id: &str) -> Result<()> {
      let mut connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.remove(id)
         && let Err(e) = connection.kill()
      {
         log::debug!("Terminal {} kill returned error: {}", id, e);
      }
      Ok(())
   }

   pub fn kill_terminal(&self, id: &str) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.kill()
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn close_all(&self) {
      let mut connections = self.connections.lock().unwrap();
      for (id, connection) in connections.drain() {
         if let Err(e) = connection.kill() {
            log::debug!("Terminal {} kill returned error during shutdown: {}", id, e);
         }
      }
   }
}

impl Drop for TerminalManager {
   fn drop(&mut self) {
      self.close_all();
   }
}
