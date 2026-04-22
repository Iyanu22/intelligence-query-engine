const express = require("express");
const { v7: uuidv7 } = require("uuid");
const https = require("https");
const db = require("./database");

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

  if (name === undefined || name === "") {
    return res.status(400).json({ status: "error", message: "Missing or empty name" });
  }
  if (typeof name !== "string") {
    return res.status(422).json({ status: "error", message: "Name must be a string" });
  }

  const existing = db.prepare("SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) {
    return res.status(200).json({ status: "success", message: "Profile already exists", data: existing });
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

    db.prepare(`
      INSERT INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at);

    const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
    return res.status(201).json({ status: "success", data: profile });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// ── GET /api/profiles/search ───────────────────────────────────────
app.get("/api/profiles/search", (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ status: "error", message: "Missing query parameter q" });

  const text = q.toLowerCase();
  const filters = {};

  // Gender
  if (text.includes("female")) filters.gender = "female";
  else if (text.includes("male")) filters.gender = "male";

  // Age group
  if (text.includes("child")) filters.age_group = "child";
  else if (text.includes("teenager")) filters.age_group = "teenager";
  else if (text.includes("adult")) filters.age_group = "adult";
  else if (text.includes("senior")) filters.age_group = "senior";
  else if (text.includes("young")) { filters.min_age = 16; filters.max_age = 24; }

  // Age expressions
  const aboveMatch = text.match(/above\s+(\d+)/);
  const belowMatch = text.match(/below\s+(\d+)/);
  const olderMatch = text.match(/older than\s+(\d+)/);
  const youngerMatch = text.match(/younger than\s+(\d+)/);
  if (aboveMatch) filters.min_age = parseInt(aboveMatch[1]);
  if (belowMatch) filters.max_age = parseInt(belowMatch[1]);
  if (olderMatch) filters.min_age = parseInt(olderMatch[1]);
  if (youngerMatch) filters.max_age = parseInt(youngerMatch[1]);

  // Country mapping
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

  // If nothing was parsed, return error
  if (Object.keys(filters).length === 0) {
    return res.status(200).json({ status: "error", message: "Unable to interpret query" });
  }

  // Build query
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params = [];

  if (filters.gender) { where += " AND LOWER(gender) = ?"; params.push(filters.gender); }
  if (filters.age_group) { where += " AND LOWER(age_group) = ?"; params.push(filters.age_group); }
  if (filters.country_id) { where += " AND LOWER(country_id) = LOWER(?)"; params.push(filters.country_id); }
  if (filters.min_age !== undefined) { where += " AND age >= ?"; params.push(filters.min_age); }
  if (filters.max_age !== undefined) { where += " AND age <= ?"; params.push(filters.max_age); }

  const total = db.prepare(`SELECT COUNT(*) as count FROM profiles ${where}`).get(...params).count;
  const data = db.prepare(`SELECT * FROM profiles ${where} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return res.status(200).json({ status: "success", page, limit, total, data });
});

// ── GET /api/profiles ──────────────────────────────────────────────
app.get("/api/profiles", (req, res) => {
  // Validate sort_by and order
  const validSortBy = ["age", "created_at", "gender_probability"];
  const validOrder = ["asc", "desc"];
  const sortBy = req.query.sort_by && validSortBy.includes(req.query.sort_by) ? req.query.sort_by : "created_at";
  const order = req.query.order && validOrder.includes(req.query.order.toLowerCase()) ? req.query.order.toLowerCase() : "asc";

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params = [];

  if (req.query.gender) { where += " AND LOWER(gender) = LOWER(?)"; params.push(req.query.gender); }
  if (req.query.country_id) { where += " AND LOWER(country_id) = LOWER(?)"; params.push(req.query.country_id); }
  if (req.query.age_group) { where += " AND LOWER(age_group) = LOWER(?)"; params.push(req.query.age_group); }
  if (req.query.min_age) { where += " AND age >= ?"; params.push(parseInt(req.query.min_age)); }
  if (req.query.max_age) { where += " AND age <= ?"; params.push(parseInt(req.query.max_age)); }
  if (req.query.min_gender_probability) { where += " AND gender_probability >= ?"; params.push(parseFloat(req.query.min_gender_probability)); }
  if (req.query.min_country_probability) { where += " AND country_probability >= ?"; params.push(parseFloat(req.query.min_country_probability)); }

  const total = db.prepare(`SELECT COUNT(*) as count FROM profiles ${where}`).get(...params).count;
  const data = db.prepare(`SELECT * FROM profiles ${where} ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return res.status(200).json({ status: "success", page, limit, total, data });
});

// ── GET /api/profiles/:id ──────────────────────────────────────────
app.get("/api/profiles/:id", (req, res) => {
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ status: "error", message: "Profile not found" });
  return res.status(200).json({ status: "success", data: profile });
});

// ── DELETE /api/profiles/:id ───────────────────────────────────────
app.delete("/api/profiles/:id", (req, res) => {
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(req.params.id);
  if (!profile) return res.status(404).json({ status: "error", message: "Profile not found" });
  db.prepare("DELETE FROM profiles WHERE id = ?").run(req.params.id);
  return res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});