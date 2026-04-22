const Database = require("better-sqlite3");
const db = new Database("profiles.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    gender TEXT,
    gender_probability REAL,
    age INTEGER,
    age_group TEXT,
    country_id TEXT,
    country_name TEXT,
    country_probability REAL,
    created_at TEXT
  )
`);

module.exports = db;