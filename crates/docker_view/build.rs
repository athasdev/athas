//! The web build compiles the Docker crate's types from its sources, with both serde directions
//! so the browser can read the server's answers and write its requests.

use std::{env, fs, path::Path};

fn main() {
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let source = Path::new(&manifest).join("../../core/docker/src/types.rs");
    println!("cargo:rerun-if-changed={}", source.display());
    let wasm = env::var("CARGO_CFG_TARGET_FAMILY").is_ok_and(|families| families.split(',').any(|family| family == "wasm"));
    if !wasm {
        return;
    }
    let text = fs::read_to_string(&source).expect("the Docker crate's types are readable");
    let types: Vec<String> = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let Some(derives) = trimmed.strip_prefix("#[derive(").and_then(|rest| rest.strip_suffix(")]")) else { return line.to_string() };
            let mut derives: Vec<&str> = derives.split(',').map(str::trim).filter(|derive| !derive.is_empty() && !derive.starts_with("specta")).collect();
            for wanted in ["Serialize", "Deserialize"] {
                if !derives.contains(&wanted) {
                    derives.push(wanted);
                }
            }
            format!("{}#[derive({})]", &line[..line.len() - trimmed.len()], derives.join(", "))
        })
        .filter(|line| !line.trim_start().starts_with("#[specta("))
        .collect();
    let out = Path::new(&env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("docker_types.rs");
    fs::write(out, types.join("\n")).expect("the generated types are written");
}
