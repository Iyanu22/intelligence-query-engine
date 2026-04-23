require("dotenv").config();
const express = require("express");
const { v7: uuidv7 } = require("uuid");
const https = require("https");
const { pool, initDB } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "Profile Intelligence Service v2" });
});

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("Invalid JSON")); }
      });
    }).on("error", reject);
  });
}

function classifyAge(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

// ── POST /api/profiles ─────────────────────────────────────────────
app.post("/api/profiles", async (req, res) => {
  const { name } = req.body;
  if (name === undefined || name === "") return res.status(400).json({ status: "error", message: "Missing or empty name" });
  if (typeof name !== "string") return res.status(422).json({ status: "error", message: "Name must be a string" });

  const existing = await pool.query("SELECT * FROM profiles WHERE LOWER(name) = LOWER($1)", [name]);
  if (existing.rows.length > 0) {
    return res.status(200).json({ status: "success", message: "Profile already exists", data: existing.rows[0] });
  }

  try {
    const encodedName = encodeURIComponent(name);
    const [genderData, ageData, nationData] = await Promise.all([
      fetchJSON(`https://api.genderize.io/?name=${encodedName}`),
      fetchJSON(`https://api.agify.io/?name=${encodedName}`),
      fetchJSON(`https://api.nationalize.io/?name=${encodedName}`),
    ]);

    if (genderData.error) return res.status(502).json({ status: "502", message: "Genderize returned an invalid response" });
    if (genderData.gender === null || genderData.count === 0) return res.status(502).json({ status: "502", message: "Genderize returned an invalid response" });
    if (ageData.error) return res.status(502).json({ status: "502", message: "Agify returned an invalid response" });
    if (ageData.age === null) return res.status(502).json({ status: "502", message: "Agify returned an invalid response" });
    if (nationData.error) return res.status(502).json({ status: "502", message: "Nationalize returned an invalid response" });
    if (!nationData.country || nationData.country.length === 0) return res.status(502).json({ status: "502", message: "Nationalize returned an invalid response" });

    const gender = genderData.gender;
    const gender_probability = genderData.probability;
    const age = ageData.age;
    const age_group = classifyAge(age);
    const topCountry = nationData.country.reduce((a, b) => a.probability > b.probability ? a : b);
    const country_id = topCountry.country_id;
    const country_name = topCountry.country_name || "";
    const country_probability = topCountry.probability;
    const id = uuidv7();
    const created_at = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at]
    );

    return res.status(201).json({ status: "success", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// ── GET /api/profiles/search ───────────────────────────────────────
app.get("/api/profiles/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ status: "error", message: "Missing query parameter q" });

  const text = q.toLowerCase();
  const filters = {};

  if (text.includes("female")) filters.gender = "female";
  else if (text.includes("male")) filters.gender = "male";

  if (text.includes("child")) filters.age_group = "child";
  else if (text.includes("teenager")) filters.age_group = "teenager";
  else if (text.includes("adult")) filters.age_group = "adult";
  else if (text.includes("senior")) filters.age_group = "senior";
  else if (text.includes("young")) { filters.min_age = 16; filters.max_age = 24; }

  const aboveMatch = text.match(/above\s+(\d+)/);
  const belowMatch = text.match(/below\s+(\d+)/);
  if (aboveMatch) filters.min_age = parseInt(aboveMatch[1]);
  if (belowMatch) filters.max_age = parseInt(belowMatch[1]);

  const countryMap = {
    "nigeria": "NG", "kenya": "KE", "ghana": "GH", "tanzania": "TZ",
    "ethiopia": "ET", "south africa": "ZA", "uganda": "UG", "senegal": "SN",
    "cameroon": "CM", "ivory coast": "CI", "mali": "ML", "angola": "AO",
    "mozambique": "MZ", "zambia": "ZM", "zimbabwe": "ZW", "rwanda": "RW",
    "egypt": "EG", "morocco": "MA", "algeria": "DZ", "tunisia": "TN",
    "sudan": "SD", "france": "FR", "united states": "US", "uk": "GB",
    "united kingdom": "GB", "germany": "DE", "india": "IN", "brazil": "BR",
    "canada": "CA", "australia": "AU", "japan": "JP", "china": "CN",
    "benin": "BJ", "togo": "TG", "niger": "NE", "burkina faso": "BF",
    "somalia": "SO", "dr congo": "CD", "congo": "CG", "gabon": "GA",
    "botswana": "BW", "namibia": "NA", "malawi": "MW", "madagascar": "MG",
  };

  for (const [country, code] of Object.entries(countryMap)) {
    if (text.includes(country)) { filters.country_id = code; break; }
  }

  if (Object.keys(filters).length === 0) {
    return res.status(200).json({ status: "error", message: "Unable to interpret query" });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params = [];
  let i = 1;

  if (filters.gender) { where += ` AND LOWER(gender) = $${i++}`; params.push(filters.gender); }
  if (filters.age_group) { where += ` AND LOWER(age_group) = $${i++}`; params.push(filters.age_group); }
  if (filters.country_id) { where += ` AND LOWER(country_id) = LOWER($${i++})`; params.push(filters.country_id); }
  if (filters.min_age !== undefined) { where += ` AND age >= $${i++}`; params.push(filters.min_age); }
  if (filters.max_age !== undefined) { where += ` AND age <= $${i++}`; params.push(filters.max_age); }

  const totalResult = await pool.query(`SELECT COUNT(*) as count FROM profiles ${where}`, params);
  const total = parseInt(totalResult.rows[0].count);
  const data = await pool.query(`SELECT * FROM profiles ${where} LIMIT $${i++} OFFSET $${i++}`, [...params, limit, offset]);

  return res.status(200).json({ status: "success", page, limit, total, data: data.rows });
});

// ── GET /api/profiles ──────────────────────────────────────────────
app.get("/api/profiles", async (req, res) => {
  const validSortBy = ["age", "created_at", "gender_probability"];
  const validOrder = ["asc", "desc"];
  const sortBy = req.query.sort_by && validSortBy.includes(req.query.sort_by) ? req.query.sort_by : "created_at";
  const order = req.query.order && validOrder.includes(req.query.order.toLowerCase()) ? req.query.order.toLowerCase() : "asc";

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params = [];
  let i = 1;

  if (req.query.gender) { where += ` AND LOWER(gender) = LOWER($${i++})`; params.push(req.query.gender); }
  if (req.query.country_id) { where += ` AND LOWER(country_id) = LOWER($${i++})`; params.push(req.query.country_id); }
  if (req.query.age_group) { where += ` AND LOWER(age_group) = LOWER($${i++})`; params.push(req.query.age_group); }
  if (req.query.min_age) { where += ` AND age >= $${i++}`; params.push(parseInt(req.query.min_age)); }
  if (req.query.max_age) { where += ` AND age <= $${i++}`; params.push(parseInt(req.query.max_age)); }
  if (req.query.min_gender_probability) { where += ` AND gender_probability >= $${i++}`; params.push(parseFloat(req.query.min_gender_probability)); }
  if (req.query.min_country_probability) { where += ` AND country_probability >= $${i++}`; params.push(parseFloat(req.query.min_country_probability)); }

  const totalResult = await pool.query(`SELECT COUNT(*) as count FROM profiles ${where}`, params);
  const total = parseInt(totalResult.rows[0].count);
  const data = await pool.query(`SELECT * FROM profiles ${where} ORDER BY ${sortBy} ${order} LIMIT $${i++} OFFSET $${i++}`, [...params, limit, offset]);

  return res.status(200).json({ status: "success", page, limit, total, data: data.rows });
});

// ── GET /api/profiles/:id ──────────────────────────────────────────
app.get("/api/profiles/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM profiles WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ status: "error", message: "Profile not found" });
  return res.status(200).json({ status: "success", data: result.rows[0] });
});

// ── DELETE /api/profiles/:id ───────────────────────────────────────
app.delete("/api/profiles/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM profiles WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ status: "error", message: "Profile not found" });
  await pool.query("DELETE FROM profiles WHERE id = $1", [req.params.id]);
  return res.status(204).send();
});

// ── START ──────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});