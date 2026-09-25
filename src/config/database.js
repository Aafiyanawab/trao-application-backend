const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not defined");
}

const client = new MongoClient(uri, {
  family: 4,
});

let db;

async function connectDatabase() {
  await client.connect();

  db = client.db(process.env.MONGODB_DB_NAME);

  await db.command({ ping: 1 });

  console.log("MongoDB connected successfully");
}

function getDatabase() {
  if (!db) {
    throw new Error("Database has not been connected");
  }

  return db;
}

module.exports = {
  connectDatabase,
  getDatabase,
};