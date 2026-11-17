#[tokio::main]
async fn main() {
   if let Err(error) = athas_database::sidecar::run_stdio().await {
      eprintln!("{}", error);
      std::process::exit(1);
   }
}
