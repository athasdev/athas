//! `athas-server [--root DIR] [--listen ADDR] [--token TOKEN] [--web DIR]`: serves a folder to the
//! web workbench. The token comes from `--token`, then `ATHAS_SERVER_TOKEN`, else a random one is
//! made and printed with the address to open.

use std::{io::Read as _, net::TcpListener, path::PathBuf, sync::Arc};

use anyhow::{Context as _, Result, bail};
use athas_server::{ServerConfig, Workspace, serve};

fn random_token() -> Result<String> {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut random| random.read_exact(&mut bytes)).context("reading /dev/urandom")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn main() -> Result<()> {
    let mut root = std::env::current_dir()?;
    let mut listen = "127.0.0.1:7878".to_string();
    let mut token = std::env::var("ATHAS_SERVER_TOKEN").ok().filter(|token| !token.is_empty());
    let mut web_dir = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().with_context(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--root" => root = PathBuf::from(value()?),
            "--listen" => listen = value()?,
            "--token" => token = Some(value()?),
            "--web" => web_dir = Some(PathBuf::from(value()?)),
            "-h" | "--help" => {
                println!("athas-server [--root DIR] [--listen ADDR] [--token TOKEN] [--web DIR]");
                return Ok(());
            }
            other => bail!("unknown argument {other}"),
        }
    }
    let token = match token {
        Some(token) => token,
        None => random_token()?,
    };
    let workspace = Workspace::open(&root)?;
    let listener = TcpListener::bind(&listen).with_context(|| format!("listening on {listen}"))?;
    let address = listener.local_addr()?;
    println!("athas-server: serving {} on http://{address}", workspace.root().display());
    println!("athas-server: open http://{address}/?token={token}");
    serve(listener, workspace, Arc::new(ServerConfig { token, web_dir }))?;
    Ok(())
}
