use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceUrls {
   extensions_cdn_base_url: String,
}

fn services() -> &'static ServiceUrls {
   static SERVICES: OnceLock<ServiceUrls> = OnceLock::new();
   SERVICES.get_or_init(|| {
      serde_json::from_str(include_str!("../../src/config/services.json"))
         .expect("src/config/services.json must contain valid service URLs")
   })
}

pub fn extensions_cdn_base_url() -> &'static str {
   &services().extensions_cdn_base_url
}
