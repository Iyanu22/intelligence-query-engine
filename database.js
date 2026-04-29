const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
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


  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id VARCHAR UNIQUE,
      username VARCHAR,
      email VARCHAR,
      avatar_url VARCHAR,
      role VARCHAR DEFAULT 'analyst',
      is_active BOOLEAN DEFAULT true,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      token TEXT UNIQUE,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("Database ready");
    const { v4: uuidv4 } = require("uuid");
  await pool.query(
    `INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'analyst', true, NOW(), NOW())
     ON CONFLICT (github_id) DO NOTHING`,
    [uuidv4(), "999999999", "test_analyst", "analyst@test.com", "https://avatars.githubusercontent.com/u/1?v=4"]
  );

  console.log("Database ready");
}

module.exports = { pool, initDB };