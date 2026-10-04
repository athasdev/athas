use crate::{
   Options,
   agent::{self, Event},
   session::Session,
};
use anyhow::{Context, Result};
use crossterm::{
   event::{self, Event as InputEvent, KeyCode, KeyEventKind, KeyModifiers},
   terminal::{disable_raw_mode, enable_raw_mode},
};
use ratatui::{
   Terminal, TerminalOptions, Viewport,
   backend::CrosstermBackend,
   layout::{Constraint, Direction, Layout},
   style::{Color, Modifier, Style},
   text::{Line, Span, Text},
   widgets::{Block, Borders, Padding, Paragraph, Widget, Wrap},
};
use std::{
   io,
   process::{Command, Stdio},
   time::Duration,
};
use tokio::{
   sync::{mpsc, oneshot},
   task::JoinHandle,
};

struct ScreenGuard;
impl ScreenGuard {
   fn enter() -> Result<Self> {
      enable_raw_mode()?;
      Ok(Self)
   }
}
impl Drop for ScreenGuard {
   fn drop(&mut self) {
      let _ = disable_raw_mode();
      println!();
   }
}

struct Ui {
   lines: Vec<(String, Color)>,
   input: String,
   cursor: usize,
   history: Vec<String>,
   history_index: Option<usize>,
   status: String,
   approval: Option<(String, oneshot::Sender<bool>)>,
   scroll: u16,
}
impl Ui {
   fn new(session: &Session) -> Self {
      let mut lines = Vec::new();
      for message in &session.messages {
         lines.push((
            format!(
               "{}  {}",
               if message.role == "user" {
                  "You"
               } else {
                  "Athas"
               },
               message.content
            ),
            if message.role == "user" {
               Color::Yellow
            } else {
               Color::White
            },
         ));
      }
      Self {
         lines,
         input: String::new(),
         cursor: 0,
         history: session
            .messages
            .iter()
            .filter(|message| message.role == "user")
            .map(|message| message.content.clone())
            .collect(),
         history_index: None,
         status: "Ready".into(),
         approval: None,
         scroll: u16::MAX,
      }
   }
   fn push(&mut self, line: String, color: Color) {
      self.lines.push((line, color));
      self.scroll = u16::MAX;
   }

   fn input_byte_offset(&self, index: usize) -> usize {
      self
         .input
         .char_indices()
         .nth(index)
         .map(|(offset, _)| offset)
         .unwrap_or(self.input.len())
   }

   fn insert(&mut self, character: char) {
      self
         .input
         .insert(self.input_byte_offset(self.cursor), character);
      self.cursor += 1;
      self.history_index = None;
   }

   fn backspace(&mut self) {
      if self.cursor > 0 {
         let start = self.input_byte_offset(self.cursor - 1);
         let end = self.input_byte_offset(self.cursor);
         self.input.replace_range(start..end, "");
         self.cursor -= 1;
      }
      self.history_index = None;
   }

   fn delete(&mut self) {
      let start = self.input_byte_offset(self.cursor);
      let end = self.input_byte_offset(self.cursor + 1);
      self.input.replace_range(start..end, "");
      self.history_index = None;
   }
}

fn transcript_height(ui: &Ui, width: u16) -> u16 {
   let width = width.max(1) as usize;
   ui.lines.iter().fold(0_u16, |total, (message, _)| {
      message
         .lines()
         .fold(total, |height, line| {
            height.saturating_add(
               line
                  .chars()
                  .count()
                  .div_ceil(width)
                  .max(1)
                  .min(u16::MAX as usize) as u16,
            )
         })
         .saturating_add(1)
   })
}

fn commit_lines(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, ui: &mut Ui) -> Result<()> {
   let width = terminal.size()?.width.saturating_sub(4).max(1);
   for (message, color) in ui.lines.drain(..) {
      let height = message.lines().fold(1_u16, |total, line| {
         total.saturating_add(
            line
               .chars()
               .count()
               .div_ceil(width as usize)
               .max(1)
               .min(u16::MAX as usize) as u16,
         )
      });
      terminal.insert_before(height, |buffer| {
         Paragraph::new(message.as_str())
            .style(Style::default().fg(color))
            .block(Block::new().padding(Padding::horizontal(2)))
            .wrap(Wrap { trim: false })
            .render(buffer.area, buffer);
      })?;
   }
   Ok(())
}

fn draw(
   terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
   ui: &Ui,
   options: &Options,
   session_id: &str,
) -> Result<()> {
   terminal.draw(|frame| {
      let outer = Layout::default()
         .direction(Direction::Vertical)
         .constraints([
            Constraint::Length(2),
            Constraint::Min(2),
            Constraint::Length(3),
            Constraint::Length(2),
         ])
         .split(frame.area());
      let project = options
         .root
         .file_name()
         .and_then(|name| name.to_str())
         .unwrap_or("workspace");
      frame.render_widget(
         Paragraph::new(Line::from(vec![
            Span::styled(
               "  ATHAS AGENT",
               Style::default()
                  .fg(Color::Cyan)
                  .add_modifier(Modifier::BOLD),
            ),
            Span::styled("   ·   ", Style::default().fg(Color::DarkGray)),
            Span::styled(project, Style::default().fg(Color::White)),
         ])),
         outer[0],
      );
      let transcript = if ui.lines.is_empty() {
         Text::from(vec![
            Line::styled("  Coding agent", Style::default().fg(Color::White)),
            Line::styled(
               "  Ask about this project or type /help",
               Style::default().fg(Color::DarkGray),
            ),
         ])
      } else {
         Text::from(
            ui.lines
               .iter()
               .flat_map(|(value, color)| {
                  let mut lines = value
                     .lines()
                     .map(|part| {
                        Line::from(Span::styled(part.to_string(), Style::default().fg(*color)))
                     })
                     .collect::<Vec<_>>();
                  lines.push(Line::raw(""));
                  lines
               })
               .collect::<Vec<_>>(),
         )
      };
      let visible = outer[1].height;
      let history = Paragraph::new(transcript).wrap(Wrap { trim: false });
      let scroll = if ui.scroll == u16::MAX {
         transcript_height(ui, outer[1].width.saturating_sub(4)).saturating_sub(visible)
      } else {
         ui.scroll
      };
      let history = history.scroll((scroll, 0));
      frame.render_widget(history, outer[1]);
      let prompt = if let Some((description, _)) = &ui.approval {
         format!("  {description}   y Allow  ·  n Deny")
      } else {
         let available = outer[2].width.saturating_sub(6) as usize;
         let start = ui.cursor.saturating_sub(available);
         let input = ui
            .input
            .chars()
            .skip(start)
            .take(available)
            .collect::<String>();
         if input.is_empty() {
            "  ❯ Ask Athas anything…".into()
         } else {
            format!("  ❯ {input}")
         }
      };
      let composer = Paragraph::new(prompt)
         .style(if ui.input.is_empty() && ui.approval.is_none() {
            Style::default().fg(Color::DarkGray)
         } else {
            Style::default().fg(Color::White)
         })
         .block(
            Block::default()
               .borders(Borders::TOP | Borders::BOTTOM)
               .border_style(Style::default().fg(Color::DarkGray)),
         );
      frame.render_widget(composer, outer[2]);
      if ui.approval.is_none() {
         let position = ui.cursor.min(outer[2].width.saturating_sub(6) as usize);
         frame.set_cursor_position((outer[2].x + 4 + position as u16, outer[2].y + 1));
      }
      let commands = [
         "/desktop",
         "/new",
         "/sessions",
         "/resume",
         "/model",
         "/models",
         "/provider",
         "/clear",
         "/help",
         "/quit",
      ];
      let hint = if ui.input.starts_with('/') {
         commands
            .iter()
            .copied()
            .filter(|command| command.starts_with(&ui.input))
            .collect::<Vec<_>>()
            .join("  ")
      } else {
         "Enter send  ·  ↑ history  ·  /help  ·  /desktop".into()
      };
      let session_hint = if outer[3].width >= 110 {
         format!("  ·  {}", &session_id[..session_id.len().min(8)])
      } else {
         String::new()
      };
      let footer = format!(
         "  {}/{}  ·  {}  ·  {}{}",
         options.provider, options.model, ui.status, hint, session_hint
      );
      frame.render_widget(
         Paragraph::new(footer).style(Style::default().fg(Color::DarkGray)),
         outer[3],
      );
   })?;
   Ok(())
}

fn open_desktop(options: &Options, session_id: &str) -> Result<()> {
   #[cfg(target_os = "macos")]
   if !options.desktop_binary.exists() {
      let application = if options.app_identifier.ends_with(".preview") {
         "Athas Preview"
      } else {
         "Athas"
      };
      let status = Command::new("/usr/bin/open")
         .args([
            "-a",
            application,
            "--args",
            "agent-session",
            session_id,
            "--cwd",
         ])
         .arg(&options.root)
         .stdin(Stdio::null())
         .stdout(Stdio::null())
         .stderr(Stdio::null())
         .status()
         .context("Could not open Athas Desktop")?;
      anyhow::ensure!(status.success(), "Athas Desktop is not installed");
      return Ok(());
   }
   let mut command = Command::new(&options.desktop_binary);
   command
      .arg("agent-session")
      .arg(session_id)
      .arg("--cwd")
      .arg(&options.root)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());
   #[cfg(unix)]
   {
      use std::os::unix::process::CommandExt;
      command.process_group(0);
   }
   command.spawn().context("Could not start Athas Desktop")?;
   Ok(())
}

pub async fn run(mut options: Options, initial_session: Session) -> Result<()> {
   let _guard = ScreenGuard::enter()?;
   let mut terminal = Terminal::with_options(
      CrosstermBackend::new(io::stdout()),
      TerminalOptions {
         viewport: Viewport::Inline(10),
      },
   )?;
   let mut ui = Ui::new(&initial_session);
   commit_lines(&mut terminal, &mut ui)?;
   let mut current_session_id = initial_session.chat.id.clone();
   let mut session = Some(initial_session);
   let mut worker: Option<JoinHandle<(Result<()>, Session)>> = None;
   let mut receiver: Option<mpsc::UnboundedReceiver<Event>> = None;
   let mut dirty = true;
   loop {
      if dirty {
         draw(&mut terminal, &ui, &options, &current_session_id)?;
         dirty = false;
      }
      if let Some(channel) = &mut receiver {
         while let Ok(update) = channel.try_recv() {
            dirty = true;
            match update {
               Event::Status(status) => ui.status = status,
               Event::TextDelta(text) => {
                  if let Some((line, color)) = ui.lines.last_mut() {
                     if *color == Color::White && line.starts_with("Athas  ") {
                        line.push_str(&text);
                     } else {
                        ui.push(format!("Athas  {text}"), Color::White);
                     }
                  } else {
                     ui.push(format!("Athas  {text}"), Color::White);
                  }
               }
               Event::Tool(name) => ui.push(format!("↳ {name}"), Color::Blue),
               Event::Permission(description, reply) => {
                  ui.status = "Approval required".into();
                  ui.approval = Some((description, reply));
               }
               Event::Done => {
                  ui.status = "Ready".into();
                  commit_lines(&mut terminal, &mut ui)?;
               }
            }
         }
      }
      if worker.as_ref().is_some_and(JoinHandle::is_finished) {
         dirty = true;
         let (result, completed) = worker.take().unwrap().await?;
         session = Some(completed);
         receiver = None;
         if let Err(error) = result {
            ui.push(format!("Error: {error:#}"), Color::Red);
            ui.status = "Failed".into();
            commit_lines(&mut terminal, &mut ui)?;
         } else {
            ui.status = "Ready".into();
         }
      }
      if !event::poll(Duration::from_millis(40))? {
         continue;
      }
      let input_event = event::read()?;
      let InputEvent::Key(key) = input_event else {
         dirty = true;
         continue;
      };
      if key.kind != KeyEventKind::Press {
         continue;
      }
      dirty = true;
      if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
         break;
      }
      if let Some((_, reply)) = ui.approval.take() {
         match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
               let _ = reply.send(true);
            }
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
               let _ = reply.send(false);
            }
            _ => {
               ui.approval = Some(("Press y to allow or n to deny".into(), reply));
            }
         }
         continue;
      }
      match key.code {
         KeyCode::Char(character) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            ui.insert(character);
         }
         KeyCode::Backspace => ui.backspace(),
         KeyCode::Delete => ui.delete(),
         KeyCode::Left => ui.cursor = ui.cursor.saturating_sub(1),
         KeyCode::Right => ui.cursor = (ui.cursor + 1).min(ui.input.chars().count()),
         KeyCode::Home => ui.cursor = 0,
         KeyCode::End => ui.cursor = ui.input.chars().count(),
         KeyCode::Tab if ui.input.starts_with('/') => {
            let commands = [
               "/desktop",
               "/new",
               "/sessions",
               "/resume ",
               "/model ",
               "/models",
               "/provider ",
               "/clear",
               "/help",
               "/quit",
            ];
            if let Some(command) = commands
               .iter()
               .find(|command| command.starts_with(&ui.input))
            {
               ui.input = (*command).into();
               ui.cursor = ui.input.chars().count();
            }
         }
         KeyCode::Up if !ui.history.is_empty() => {
            let index = ui.history_index.unwrap_or(ui.history.len());
            let index = index.saturating_sub(1);
            ui.input = ui.history[index].clone();
            ui.cursor = ui.input.chars().count();
            ui.history_index = Some(index);
         }
         KeyCode::Down if let Some(index) = ui.history_index => {
            if index + 1 < ui.history.len() {
               ui.input = ui.history[index + 1].clone();
               ui.cursor = ui.input.chars().count();
               ui.history_index = Some(index + 1);
            } else {
               ui.input.clear();
               ui.cursor = 0;
               ui.history_index = None;
            }
         }
         KeyCode::PageUp => {
            ui.scroll = if ui.scroll == u16::MAX {
               transcript_height(&ui, terminal.size()?.width.saturating_sub(2)).saturating_sub(10)
            } else {
               ui.scroll.saturating_sub(10)
            };
         }
         KeyCode::PageDown => ui.scroll = ui.scroll.saturating_add(10),
         KeyCode::Enter => {
            let prompt = ui.input.trim().to_string();
            ui.input.clear();
            ui.cursor = 0;
            if prompt.is_empty() {
               continue;
            }
            if prompt.starts_with('/') {
               match prompt.as_str() {
                  "/quit" | "/exit" => break,
                  "/desktop" if worker.is_none() => {
                     match open_desktop(&options, &current_session_id) {
                        Ok(()) => break,
                        Err(error) => ui.push(format!("Desktop: {error}"), Color::Red),
                     }
                  }
                  "/desktop" => ui.push(
                     "Wait for this turn to finish before opening Desktop".into(),
                     Color::Yellow,
                  ),
                  "/help" => ui.push(
                     "/desktop  Continue this session in Desktop\n/new  New session\n/sessions  \
                      Recent sessions\n/resume ID  Open session\n/model [ID]  Show or change \
                      model\n/models  Available Athas models\n/provider NAME  Change \
                      provider\n/clear  Clear view\n/quit  Exit"
                        .into(),
                     Color::Cyan,
                  ),
                  "/model" => ui.push(
                     format!("{} / {}", options.provider, options.model),
                     Color::Cyan,
                  ),
                  "/models" => {
                     ui.status = "Loading models".into();
                     draw(&mut terminal, &ui, &options, &current_session_id)?;
                     match agent::list_models(&options).await {
                        Ok(models) => ui.push(
                           models
                              .iter()
                              .map(|(id, name)| format!("{id}  {name}"))
                              .collect::<Vec<_>>()
                              .join("\n"),
                           Color::Cyan,
                        ),
                        Err(error) => ui.push(format!("Models: {error:#}"), Color::Red),
                     }
                     ui.status = "Ready".into();
                  }
                  "/sessions" => {
                     let root = options.root.to_string_lossy();
                     if let Some(active) = &session {
                        let sessions = active.list(&root)?;
                        let list = sessions
                           .iter()
                           .map(|chat| format!("{}  {}", chat.id, chat.title))
                           .collect::<Vec<_>>()
                           .join("\n");
                        ui.push(
                           if list.is_empty() {
                              "No sessions yet".into()
                           } else {
                              list
                           },
                           Color::Cyan,
                        );
                     }
                  }
                  value if value.starts_with("/resume ") && worker.is_none() => {
                     let mut next = options.clone();
                     next.session = Some(value[8..].trim().into());
                     next.continue_last = false;
                     match Session::open(&next) {
                        Ok(opened) => {
                           current_session_id = opened.chat.id.clone();
                           options.provider =
                              opened.chat.provider_id.clone().unwrap_or(options.provider);
                           options.model = opened.chat.model_id.clone().unwrap_or(options.model);
                           ui = Ui::new(&opened);
                           session = Some(opened);
                        }
                        Err(error) => ui.push(format!("Resume failed: {error}"), Color::Red),
                     }
                  }
                  value if value.starts_with("/model ") && worker.is_none() => {
                     let model = value[7..].trim();
                     if !model.is_empty() {
                        options.model = model.into();
                        if let Some(active) = &mut session {
                           active
                              .update_connection(options.provider.clone(), options.model.clone())?;
                        }
                        ui.push(format!("Model: {}", options.model), Color::Green);
                     }
                  }
                  value if value.starts_with("/provider ") && worker.is_none() => {
                     let provider = value[10..].trim();
                     if matches!(provider, "athas" | "openai" | "openrouter" | "ollama") {
                        options.provider = provider.into();
                        if provider == "athas" && options.model.is_empty() {
                           options.model = "auto".into();
                        } else if provider != "athas" && options.model == "auto" {
                           options.model.clear();
                        }
                        if let Some(active) = &mut session {
                           active
                              .update_connection(options.provider.clone(), options.model.clone())?;
                        }
                        ui.push(format!("Provider: {}", options.provider), Color::Green);
                     } else {
                        ui.push(
                           "Providers: athas, openai, openrouter, ollama".into(),
                           Color::Yellow,
                        );
                     }
                  }
                  "/clear" => ui.lines.clear(),
                  "/new" if worker.is_none() => {
                     let mut next = options.clone();
                     next.session = None;
                     next.continue_last = false;
                     let fresh = Session::open(&next)?;
                     current_session_id = fresh.chat.id.clone();
                     ui = Ui::new(&fresh);
                     session = Some(fresh);
                  }
                  "/new" => ui.push(
                     "Wait for the current turn before starting a new session".into(),
                     Color::Yellow,
                  ),
                  _ => ui.push(
                     format!("Unknown command: {prompt}. Use /help"),
                     Color::Yellow,
                  ),
               }
               commit_lines(&mut terminal, &mut ui)?;
               continue;
            }
            if worker.is_some() {
               ui.push(
                  "Agent is working. Wait for this turn to finish.".into(),
                  Color::Yellow,
               );
               continue;
            }
            if options.model.is_empty() {
               ui.push("Select a model with /model ID".into(), Color::Yellow);
               commit_lines(&mut terminal, &mut ui)?;
               continue;
            }
            ui.push(format!("You  {prompt}"), Color::Yellow);
            commit_lines(&mut terminal, &mut ui)?;
            ui.history.push(prompt.clone());
            ui.history_index = None;
            ui.status = "Starting".into();
            let active = session.take().context("Missing session")?;
            let (sender, channel) = mpsc::unbounded_channel();
            let worker_options = options.clone();
            worker = Some(tokio::spawn(async move {
               let mut active = active;
               let result = agent::run_turn(&worker_options, &mut active, prompt, sender).await;
               (result, active)
            }));
            receiver = Some(channel);
         }
         _ => {}
      }
   }
   if let Some(worker) = worker {
      worker.abort();
   }
   terminal.clear()?;
   Ok(())
}
