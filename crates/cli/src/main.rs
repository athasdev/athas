//! `athas`: hands paths, lines and commands to a running Athas, starting it when needed.

use std::{path::Path, process::ExitCode, time::Duration};

use cli::{
    CliRequest, HELP_TEXT,
    args::with_wait_marker,
    launch, parse_cli,
    protocol::{self, Message, Reply},
    transport, wait,
};

const LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);
const WAIT_POLL: Duration = Duration::from_millis(200);
/// While waiting, how many polls pass between checks that Athas is still running.
const POLLS_PER_PING: u32 = 10;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("help" | "-h" | "--help") => {
            print!("{HELP_TEXT}");
            return ExitCode::SUCCESS;
        }
        Some("-v" | "--version") => {
            println!("athas {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    match run(&args) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("athas: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    let cwd = std::env::current_dir().map_err(|error| format!("could not read the working directory: {error}"))?;
    let parsed = parse_cli(args, &cwd)
        .ok_or("invalid arguments or a path that does not exist. Run athas --help for usage.")?;
    let socket = transport::socket_path().ok_or("could not find the Athas data folder")?;

    if !parsed.wait {
        open(&socket, parsed.requests)?;
        return Ok(ExitCode::SUCCESS);
    }
    let marker = wait::create_marker().map_err(|error| format!("could not create the wait marker: {error}"))?;
    let marker_text = marker.to_string_lossy().into_owned();
    if let Err(error) = open(&socket, with_wait_marker(parsed.requests, &marker_text)) {
        wait::release_marker(&marker_text).ok();
        return Err(error);
    }
    let mut polls = 0;
    while marker.exists() {
        std::thread::sleep(WAIT_POLL);
        polls += 1;
        if polls % POLLS_PER_PING == 0 && !protocol::ping(&socket) {
            wait::release_marker(&marker_text).ok();
            return Err("Athas quit before the files were closed".into());
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn open(socket: &Path, requests: Vec<CliRequest>) -> Result<(), String> {
    let message = Message::Open { requests };
    let reply = match protocol::send(socket, &message) {
        Ok(reply) => reply,
        Err(_) => {
            launch::launch_and_wait(socket, LAUNCH_TIMEOUT).map_err(|error| format!("could not start Athas: {error}"))?;
            protocol::send(socket, &message).map_err(|error| format!("could not reach Athas: {error}"))?
        }
    };
    match reply {
        Reply::Ok => Ok(()),
        Reply::Error { message } => Err(message),
    }
}
