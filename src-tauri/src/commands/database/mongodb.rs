use athas_database::{
   ConnectionManager,
   providers::{
      MongoCollectionInfo, delete_mongo_document as db_delete_mongo_document,
      get_mongo_collections as db_get_mongo_collections,
      get_mongo_databases as db_get_mongo_databases,
      insert_mongo_document as db_insert_mongo_document,
      query_mongo_documents as db_query_mongo_documents,
      update_mongo_document as db_update_mongo_document,
   },
};
use std::sync::Arc;

#[tauri::command]
pub async fn get_mongo_databases(
   connection_id: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<String>, String> {
   db_get_mongo_databases(connection_id, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn get_mongo_collections(
   connection_id: String,
   database: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<MongoCollectionInfo>, String> {
   db_get_mongo_collections(connection_id, database, state.inner().as_ref()).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_mongo_documents(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: Option<String>,
   sort_json: Option<String>,
   limit: Option<i64>,
   skip: Option<u64>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<serde_json::Value, String> {
   db_query_mongo_documents(
      connection_id,
      database,
      collection,
      filter_json,
      sort_json,
      limit,
      skip,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn insert_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   document_json: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<String, String> {
   db_insert_mongo_document(
      connection_id,
      database,
      collection,
      document_json,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn delete_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
   db_delete_mongo_document(
      connection_id,
      database,
      collection,
      filter_json,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn update_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: String,
   update_json: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<u64, String> {
   db_update_mongo_document(
      connection_id,
      database,
      collection,
      filter_json,
      update_json,
      state.inner().as_ref(),
   )
   .await
}
