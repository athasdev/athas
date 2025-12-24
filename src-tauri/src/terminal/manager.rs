use crate::terminal::{config::TerminalConfig, connection::TerminalConnection};
use anyhow::{Result, anyhow};
use std::{
   collections::HashMap,
   sync::{Arc, Mutex},
};
use tauri::AppHandle;
use uuid::Uuid;

pub struct TerminalManager {
   connections: Arc<Mutex<HashMap<String, TerminalConnection>>>,
}

impl TerminalManager {
   pub fn new() -> Self {
      Self {
         connections: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub fn create_terminal(&self, config: TerminalConfig, app_handle: AppHandle) -> Result<String> {
      let id = Uuid::new_v4().to_string();
      let connection = TerminalConnection::new(id.clone(), config, app_handle)?;

      // Start the reader thread
      connection.start_reader_thread();

      // Store the connection
      let mut connections = self.connections.lock().unwrap();
      connections.insert(id.clone(), connection);

      Ok(id)
   }

   pub fn write_to_terminal(&self, id: &str, data: &str) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.write(data)
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn resize_terminal(&self, id: &str, rows: u16, cols: u16) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.resize(rows, cols)
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn close_terminal(&self, id: &str) -> Result<()> {
      let mut connections = self.connections.lock().unwrap();
      connections.remove(id);
      Ok(())
   }
}
