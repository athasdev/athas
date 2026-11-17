//! The web build's copies of the `athas-github` types that live beside its HTTP code (releases,
//! deployments and the token's source), so they cannot be compiled from the crate's sources the
//! way `models.rs` is. Field for field the same, so the server's answers read back unchanged.

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHubTokenSource {
    Athas,
    PersonalAccessToken,
    GhCli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSourcePreference {
    Auto,
    Athas,
    PersonalAccessToken,
    GhCli,
}

impl TokenSourcePreference {
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("athas") => Self::Athas,
            Some("pat") => Self::PersonalAccessToken,
            Some("gh") => Self::GhCli,
            _ => Self::Auto,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::{Serialize, de::DeserializeOwned};
    use serde_json::{Value, json};

    fn same<Original: DeserializeOwned + Serialize, Copy: DeserializeOwned + Serialize>(value: Value) {
        let original: Original = serde_json::from_value(value).unwrap();
        let sent = serde_json::to_value(&original).unwrap();
        let copy: Copy = serde_json::from_value(sent.clone()).unwrap();
        assert_eq!(serde_json::to_value(copy).unwrap(), sent);
    }

    #[test]
    fn copies_read_what_the_crate_sends() {
        let user = json!({ "login": "octo", "avatar_url": null });
        let asset = json!({ "id": 3, "name": "a.zip", "label": null, "size": 10, "download_count": 2, "browser_download_url": "u", "content_type": "application/zip", "state": "uploaded", "digest": null });
        same::<athas_github::Release, super::Release>(json!({
            "id": 1, "tag_name": "v1", "target_commitish": "main", "name": "One", "body": "b", "draft": false, "prerelease": true,
            "html_url": "h", "created_at": "c", "published_at": null, "author": user, "assets": [asset], "zipball_url": null, "tarball_url": null, "discussion_url": null,
        }));
        let status = json!({ "id": 5, "state": "success", "description": null, "environment": "prod", "environment_url": null, "log_url": null, "created_at": "c", "creator": user });
        same::<athas_github::Deployment, super::Deployment>(json!({
            "id": 2, "sha": "abc", "ref": "main", "task": "deploy", "environment": "prod", "description": null, "created_at": "c", "updated_at": "u",
            "creator": null, "statuses": [status],
        }));
        same::<athas_github::ReleaseInput, super::ReleaseInput>(json!({ "tag_name": "v1", "target_commitish": "main", "name": "n", "body": "b", "prerelease": false }));
        assert_eq!(serde_json::to_value(athas_github::GitHubTokenSource::GhCli).unwrap(), serde_json::to_value(super::GitHubTokenSource::GhCli).unwrap());
        assert_eq!(serde_json::to_value(athas_github::GitHubTokenSource::PersonalAccessToken).unwrap(), json!("personalAccessToken"));
    }
}
