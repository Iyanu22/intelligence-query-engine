require("dotenv").config();
const { pool, initDB } = require("./database");

async function addIndexes() {
  await initDB();
  console.log("Adding indexes...");

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(LOWER(name))`);

  console.log("All indexes created!");
  await pool.end();
}

addIndexes();