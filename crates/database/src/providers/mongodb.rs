use crate::{ConnectionManager, DatabasePool};
use mongodb::bson::{Document, doc};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MongoCollectionInfo {
   pub name: String,
   pub count: u64,
}

pub async fn get_mongo_databases(
   connection_id: String,
   manager: &ConnectionManager,
) -> Result<Vec<String>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };
   client
      .list_database_names()
      .await
      .map_err(|e| format!("Failed to list databases: {}", e))
}

pub async fn get_mongo_collections(
   connection_id: String,
   database: String,
   manager: &ConnectionManager,
) -> Result<Vec<MongoCollectionInfo>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };

   let db = client.database(&database);
   let names = db
      .list_collection_names()
      .await
      .map_err(|e| format!("Failed to list collections: {}", e))?;

   let mut collections = Vec::new();
   for name in names {
      let count = db
         .collection::<Document>(&name)
         .estimated_document_count()
         .await
         .unwrap_or(0);
      collections.push(MongoCollectionInfo { name, count });
   }

   Ok(collections)
}

#[allow(clippy::too_many_arguments)]
pub async fn query_mongo_documents(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: Option<String>,
   sort_json: Option<String>,
   limit: Option<i64>,
   skip: Option<u64>,
   manager: &ConnectionManager,
) -> Result<serde_json::Value, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };

   let db = client.database(&database);
   let coll = db.collection::<Document>(&collection);

   let filter_doc: Document = if let Some(ref filter) = filter_json {
      serde_json::from_str(filter).map_err(|e| format!("Invalid filter JSON: {}", e))?
   } else {
      doc! {}
   };

   let sort_doc = if let Some(ref sort) = sort_json {
      Some(serde_json::from_str::<Document>(sort).map_err(|e| format!("Invalid sort JSON: {}", e))?)
   } else {
      None
   };

   use futures_util::StreamExt;
   let mut find = coll.find(filter_doc.clone());
   if let Some(sort_doc) = sort_doc {
      find = find.sort(sort_doc);
   }
   if let Some(l) = limit {
      find = find.limit(l);
   }
   if let Some(s) = skip {
      find = find.skip(s);
   }
   let mut cursor = find.await.map_err(|e| format!("Failed to query: {}", e))?;

   let mut documents: Vec<serde_json::Value> = Vec::new();
   while let Some(result) = cursor.next().await {
      match result {
         Ok(doc) => {
            let json = serde_json::to_value(&doc)
               .map_err(|e| format!("Failed to serialize document: {}", e))?;
            documents.push(json);
         }
         Err(e) => return Err(format!("Error reading document: {}", e)),
      }
   }

   let total_count = coll
      .count_documents(filter_doc)
      .await
      .map_err(|e| format!("Failed to count: {}", e))?;

   Ok(serde_json::json!({
       "documents": documents,
       "total_count": total_count
   }))
}

pub async fn insert_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   document_json: String,
   manager: &ConnectionManager,
) -> Result<String, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };

   let doc: Document =
      serde_json::from_str(&document_json).map_err(|e| format!("Invalid document JSON: {}", e))?;

   let result = client
      .database(&database)
      .collection::<Document>(&collection)
      .insert_one(doc)
      .await
      .map_err(|e| format!("Failed to insert: {}", e))?;

   Ok(result.inserted_id.to_string())
}

pub async fn delete_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: String,
   manager: &ConnectionManager,
) -> Result<u64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };

   let filter: Document =
      serde_json::from_str(&filter_json).map_err(|e| format!("Invalid filter: {}", e))?;

   let result = client
      .database(&database)
      .collection::<Document>(&collection)
      .delete_one(filter)
      .await
      .map_err(|e| format!("Failed to delete: {}", e))?;

   Ok(result.deleted_count)
}

pub async fn update_mongo_document(
   connection_id: String,
   database: String,
   collection: String,
   filter_json: String,
   update_json: String,
   manager: &ConnectionManager,
) -> Result<u64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let client = match pool_arc.as_ref() {
      DatabasePool::Mongo(c) => c,
      _ => return Err("Invalid pool type".to_string()),
   };

   let filter: Document =
      serde_json::from_str(&filter_json).map_err(|e| format!("Invalid filter: {}", e))?;
   let update: Document =
      serde_json::from_str(&update_json).map_err(|e| format!("Invalid update: {}", e))?;

   let update_doc = doc! { "$set": update };

   let result = client
      .database(&database)
      .collection::<Document>(&collection)
      .update_one(filter, update_doc)
      .await
      .map_err(|e| format!("Failed to update: {}", e))?;

   Ok(result.modified_count)
}
