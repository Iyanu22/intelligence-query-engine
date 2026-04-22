const db = require("./database");
const { v7: uuidv7 } = require("uuid");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync("./seed_profiles.json", "utf8"));
const profiles = data.profiles;

const insert = db.prepare(`
  INSERT OR IGNORE INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((profiles) => {
  for (const p of profiles) {
    insert.run(
      uuidv7(),
      p.name,
      p.gender,
      p.gender_probability,
      p.age,
      p.age_group,
      p.country_id,
      p.country_name,
      p.country_probability,
      new Date().toISOString()
    );
  }
});

insertMany(profiles);
console.log(`Seeded ${profiles.length} profiles`);