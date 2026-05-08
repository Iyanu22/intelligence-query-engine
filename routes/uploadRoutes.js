const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { pool } = require("../database");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireAdmin } = require("../auth");

const router = express.Router();

// Store file in memory (buffer) — we stream it ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

const VALID_GENDERS = ["male", "female"];
const VALID_AGE_GROUPS = ["child", "teenager", "adult", "senior"];
const BATCH_SIZE = 1000; // Insert 1000 rows at a time

function classifyAge(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

function validateRow(row) {
  const errors = [];

  // Check required fields
  const required = ["name", "gender", "age", "country_id"];
  for (const field of required) {
    if (!row[field] || String(row[field]).trim() === "") {
      errors.push("missing_fields");
      return errors;
    }
  }

  // Validate gender
  if (!VALID_GENDERS.includes(row.gender.toLowerCase().trim())) {
    errors.push("invalid_gender");
  }

  // Validate age
  const age = parseInt(row.age);
  if (isNaN(age) || age < 0 || age > 150) {
    errors.push("invalid_age");
  }

  return errors;
}

async function insertBatch(batch) {
  if (batch.length === 0) return { inserted: 0, duplicates: 0 };

  const values = batch.map((_, i) => {
    const offset = i * 10;
    return `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10})`;
  }).join(",");

  const params = batch.flatMap(row => [
    row.id, row.name, row.gender, row.gender_probability,
    row.age, row.age_group, row.country_id, row.country_name,
    row.country_probability, row.created_at
  ]);

  const result = await pool.query(
    `INSERT INTO profiles (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
     VALUES ${values}
     ON CONFLICT (name) DO NOTHING`,
    params
  );

  const inserted = result.rowCount;
  const duplicates = batch.length - inserted;
  return { inserted, duplicates };
}

// POST /api/upload
router.post("/", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: "error", message: "No file uploaded" });
  }

  const stats = {
    total_rows: 0,
    inserted: 0,
    skipped: 0,
    reasons: {
      duplicate_name: 0,
      invalid_age: 0,
      invalid_gender: 0,
      missing_fields: 0,
      malformed_row: 0,
    }
  };

  const batch = [];

  const processRow = async (row) => {
    stats.total_rows++;

    // Check column count
    const keys = Object.keys(row);
    if (keys.length < 4) {
      stats.skipped++;
      stats.reasons.malformed_row++;
      return;
    }

    // Validate row
    const errors = validateRow(row);
    if (errors.length > 0) {
      stats.skipped++;
      errors.forEach(e => {
        if (stats.reasons[e] !== undefined) stats.reasons[e]++;
      });
      return;
    }

    const age = parseInt(row.age);
    const age_group = row.age_group && VALID_AGE_GROUPS.includes(row.age_group.toLowerCase())
      ? row.age_group.toLowerCase()
      : classifyAge(age);

    batch.push({
      id: uuidv4(),
      name: row.name.trim(),
      gender: row.gender.toLowerCase().trim(),
      gender_probability: parseFloat(row.gender_probability) || 0.5,
      age,
      age_group,
      country_id: row.country_id.toUpperCase().trim(),
      country_name: (row.country_name || "").trim(),
      country_probability: parseFloat(row.country_probability) || 0.5,
      created_at: new Date().toISOString(),
    });

    // Insert batch when it reaches BATCH_SIZE
    if (batch.length >= BATCH_SIZE) {
      const batchCopy = batch.splice(0, BATCH_SIZE);
      try {
        const result = await insertBatch(batchCopy);
        stats.inserted += result.inserted;
        stats.skipped += result.duplicates;
        stats.reasons.duplicate_name += result.duplicates;
      } catch (err) {
        console.error("Batch insert error:", err.message);
        stats.skipped += batchCopy.length;
        stats.reasons.malformed_row += batchCopy.length;
      }
    }
  };

  // Stream the CSV from buffer
  await new Promise((resolve, reject) => {
    const readable = Readable.from(req.file.buffer);
    readable
      .pipe(csv())
      .on("data", async (row) => {
        readable.pause();
        try {
          await processRow(row);
        } catch (err) {
          stats.skipped++;
          stats.reasons.malformed_row++;
        }
        readable.resume();
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // Insert remaining rows
  if (batch.length > 0) {
    try {
      const result = await insertBatch(batch);
      stats.inserted += result.inserted;
      stats.skipped += result.duplicates;
      stats.reasons.duplicate_name += result.duplicates;
    } catch (err) {
      stats.skipped += batch.length;
      stats.reasons.malformed_row += batch.length;
    }
  }

  return res.status(200).json({
    status: "success",
    total_rows: stats.total_rows,
    inserted: stats.inserted,
    skipped: stats.skipped,
    reasons: stats.reasons,
  });
});

module.exports = router;