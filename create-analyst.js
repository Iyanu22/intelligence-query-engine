require("dotenv").config();
const { pool, initDB } = require("./database");
const { v4: uuidv4 } = require("uuid");

async function createAnalyst() {
  await initDB();
  await pool.query(
    `INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'analyst', true, NOW(), NOW())
     ON CONFLICT (github_id) DO NOTHING`,
    [uuidv4(), "999999999", "test_analyst", "analyst@test.com", "https://avatars.githubusercontent.com/u/1?v=4"]
  );
  console.log("Analyst user created!");
  await pool.end();
}

createAnalyst();