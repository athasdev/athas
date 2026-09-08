use super::{GitHubApi, repo_path, resolve_repo_slug};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeliveryUser {
   pub login: String,
   pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReleaseAsset {
   pub id: i64,
   pub name: String,
   pub label: Option<String>,
   pub size: u64,
   pub download_count: u64,
   pub browser_download_url: String,
   pub content_type: String,
   pub state: String,
   pub digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Release {
   pub id: i64,
   pub tag_name: String,
   pub target_commitish: String,
   pub name: Option<String>,
   pub body: Option<String>,
   pub draft: bool,
   pub prerelease: bool,
   #[serde(default)]
   pub immutable: bool,
   pub html_url: String,
   pub created_at: String,
   pub published_at: Option<String>,
   pub author: Option<DeliveryUser>,
   pub assets: Vec<ReleaseAsset>,
   pub zipball_url: Option<String>,
   pub tarball_url: Option<String>,
   pub discussion_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ReleaseInput {
   pub tag_name: String,
   pub target_commitish: String,
   pub name: String,
   pub body: String,
   pub prerelease: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeploymentStatus {
   pub id: i64,
   pub state: String,
   pub description: Option<String>,
   pub environment: Option<String>,
   pub environment_url: Option<String>,
   pub log_url: Option<String>,
   pub created_at: String,
   pub creator: Option<DeliveryUser>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Deployment {
   pub id: i64,
   pub sha: String,
   #[serde(rename = "ref")]
   pub git_ref: String,
   pub task: String,
   pub environment: String,
   pub description: Option<String>,
   pub created_at: String,
   pub updated_at: String,
   pub creator: Option<DeliveryUser>,
   #[serde(default)]
   pub transient_environment: bool,
   #[serde(default)]
   pub production_environment: bool,
   #[serde(default)]
   pub statuses: Vec<DeploymentStatus>,
   #[serde(default)]
   pub status_error: Option<String>,
}

fn validate_id(id: i64) -> Result<(), String> {
   if id <= 0 {
      return Err("Invalid GitHub resource ID".into());
   }
   Ok(())
}

fn validate_page(page: u32) -> Result<(), String> {
   if page == 0 {
      return Err("Page must be greater than zero".into());
   }
   Ok(())
}

pub fn github_list_releases(
   path: String,
   page: u32,
   token: Option<String>,
) -> Result<Vec<Release>, String> {
   validate_page(page)?;
   let slug = resolve_repo_slug(&path)?;
   GitHubApi::new_authenticated(token)?.get_json_with_query(
      &repo_path(&slug, "releases"),
      &[("per_page", "20".into()), ("page", page.to_string())],
   )
}

pub fn github_get_release(path: String, id: i64, token: Option<String>) -> Result<Release, String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   let api = GitHubApi::new_authenticated(token)?;
   let mut release: Release = api.get_json(&repo_path(&slug, &format!("releases/{id}")))?;
   release.assets = api.get_all_pages_json(&repo_path(&slug, &format!("releases/{id}/assets")))?;
   Ok(release)
}

pub fn github_save_release(
   path: String,
   id: Option<i64>,
   input: ReleaseInput,
   token: Option<String>,
) -> Result<Release, String> {
   if input.tag_name.trim().is_empty() {
      return Err("A release tag is required".into());
   }
   if input.target_commitish.trim().is_empty() {
      return Err("A target branch or commit is required".into());
   }
   let slug = resolve_repo_slug(&path)?;
   let api = GitHubApi::new_authenticated(token)?;
   let mut body = serde_json::to_value(input).map_err(|e| e.to_string())?;
   if let Some(id) = id {
      validate_id(id)?;
      api.patch_json(&repo_path(&slug, &format!("releases/{id}")), &body)
   } else {
      body["draft"] = serde_json::json!(true);
      api.post_json(&repo_path(&slug, "releases"), &body)
   }
}

pub fn github_publish_release(
   path: String,
   id: i64,
   make_latest: bool,
   token: Option<String>,
) -> Result<Release, String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   GitHubApi::new_authenticated(token)?.patch_json(
      &repo_path(&slug, &format!("releases/{id}")),
      &serde_json::json!({"draft": false, "make_latest": if make_latest { "true" } else { "false" }}),
   )
}

pub fn github_delete_release(path: String, id: i64, token: Option<String>) -> Result<(), String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   GitHubApi::new_authenticated(token)?.delete_empty(&repo_path(&slug, &format!("releases/{id}")))
}

pub fn github_generate_release_notes(
   path: String,
   tag: String,
   target: String,
   previous_tag: Option<String>,
   token: Option<String>,
) -> Result<serde_json::Value, String> {
   if tag.trim().is_empty() || target.trim().is_empty() {
      return Err("A tag and target are required".into());
   }
   let slug = resolve_repo_slug(&path)?;
   let mut body = serde_json::json!({"tag_name": tag, "target_commitish": target});
   if let Some(previous) = previous_tag.filter(|value| !value.trim().is_empty()) {
      body["previous_tag_name"] = serde_json::json!(previous);
   }
   GitHubApi::new_authenticated(token)?
      .post_json(&repo_path(&slug, "releases/generate-notes"), &body)
}

pub fn github_list_deployments(
   path: String,
   page: u32,
   token: Option<String>,
) -> Result<Vec<Deployment>, String> {
   validate_page(page)?;
   let slug = resolve_repo_slug(&path)?;
   let api = GitHubApi::new_authenticated(token)?;
   let mut deployments: Vec<Deployment> = api.get_json_with_query(
      &repo_path(&slug, "deployments"),
      &[("per_page", "20".into()), ("page", page.to_string())],
   )?;
   for chunk in deployments.chunks_mut(4) {
      std::thread::scope(|scope| {
         for deployment in chunk {
            let api = &api;
            let slug = &slug;
            scope.spawn(move || {
               match api.get_json_with_query::<Vec<DeploymentStatus>>(
                  &repo_path(slug, &format!("deployments/{}/statuses", deployment.id)),
                  &[("per_page", "1".into())],
               ) {
                  Ok(statuses) => deployment.statuses = statuses,
                  Err(error) => deployment.status_error = Some(error),
               }
            });
         }
      });
   }
   Ok(deployments)
}

pub fn github_get_deployment(
   path: String,
   id: i64,
   token: Option<String>,
) -> Result<Deployment, String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   let api = GitHubApi::new_authenticated(token)?;
   let mut deployment: Deployment =
      api.get_json(&repo_path(&slug, &format!("deployments/{id}")))?;
   deployment.statuses =
      api.get_all_pages_json(&repo_path(&slug, &format!("deployments/{id}/statuses")))?;
   Ok(deployment)
}

pub fn github_deactivate_deployment(
   path: String,
   id: i64,
   token: Option<String>,
) -> Result<DeploymentStatus, String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   GitHubApi::new_authenticated(token)?.post_json(
      &repo_path(&slug, &format!("deployments/{id}/statuses")),
      &serde_json::json!({"state": "inactive", "auto_inactive": false}),
   )
}

pub fn github_upload_release_asset(
   path: String,
   id: i64,
   file_path: String,
   token: Option<String>,
) -> Result<ReleaseAsset, String> {
   validate_id(id)?;
   let slug = resolve_repo_slug(&path)?;
   let api = GitHubApi::new_authenticated(token)?;
   let source = std::path::Path::new(&file_path);
   let name = source
      .file_name()
      .and_then(|name| name.to_str())
      .ok_or("Invalid asset filename")?;
   let file = std::fs::File::open(source).map_err(|error| format!("Cannot open asset: {error}"))?;
   let metadata = file
      .metadata()
      .map_err(|error| format!("Cannot read asset: {error}"))?;
   if !metadata.is_file() {
      return Err("Release assets must be regular files".into());
   }
   let request = api
      .apply_headers(
         api.client.post(format!(
            "https://uploads.github.com{}",
            repo_path(&slug, &format!("releases/{id}/assets"))
         )),
         super::GITHUB_JSON_ACCEPT,
      )
      .query(&[("name", name)])
      .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
      .header(reqwest::header::CONTENT_LENGTH, metadata.len())
      .timeout(std::time::Duration::from_secs(1800))
      .body(reqwest::blocking::Body::new(file));
   super::send_github_request(request)?
      .json::<ReleaseAsset>()
      .map_err(|error| format!("Cannot read uploaded asset: {error}"))
}

pub fn github_delete_release_asset(
   path: String,
   asset_id: i64,
   token: Option<String>,
) -> Result<(), String> {
   validate_id(asset_id)?;
   let slug = resolve_repo_slug(&path)?;
   GitHubApi::new_authenticated(token)?
      .delete_empty(&repo_path(&slug, &format!("releases/assets/{asset_id}")))
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn validates_resource_ids_and_pages() {
      assert!(validate_id(0).is_err());
      assert!(validate_id(-1).is_err());
      assert!(validate_id(123).is_ok());
      assert!(validate_page(0).is_err());
      assert!(validate_page(1).is_ok());
   }

   #[test]
   fn deployment_without_status_is_not_assumed_successful() {
      let deployment: Deployment = serde_json::from_value(serde_json::json!({
         "id": 1, "sha": "abc", "ref": "main", "task": "deploy", "environment": "production",
         "created_at": "2026-09-08T00:00:00Z", "updated_at": "2026-09-08T00:00:00Z"
      }))
      .unwrap();
      assert!(deployment.statuses.is_empty());
      assert!(deployment.status_error.is_none());
      assert_eq!(deployment.git_ref, "main");
   }
}
