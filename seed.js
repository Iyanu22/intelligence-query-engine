require("dotenv").config();
const { pool, initDB } = require("./database");
const { v7: uuidv7 } = require("uuid");
const fs = require("fs");

async function seed() {
  await initDB();
  const data = JSON.parse(fs.readFileSync("./seed_profiles.json", "utf8"));
  const profiles = data.profiles;

  // Insert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < profiles.length; i += batchSize) {
    const batch = profiles.slice(i, i + batchSize);
    const values = batch.map((p, j) => {
      const offset = j * 10;
      return `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10})`;
    }).join(",");

    const params = batch.flatMap(p => [
      uuidv7(), p.name, p.gender, p.gender_probability,
      p.age, p.age_group, p.country_id, p.country_name,
      p.country_probability, new Date().toISOString()
    ]);

    await pool.query(
      `INSERT INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
       VALUES ${values} ON CONFLICT (name) DO NOTHING`,
      params
    );
    console.log(`Inserted ${Math.min(i + batchSize, profiles.length)} / ${profiles.length}`);
  }

  console.log("Seeding complete!");
  await pool.end();
}

seed();