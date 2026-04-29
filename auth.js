const jwt = require("jsonwebtoken");
const { pool } = require("./database");
const { v4: uuidv4 } = require("uuid");

const JWT_SECRET = process.env.JWT_SECRET;

// Generate access token (3 mins)
function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "3m" }
  );
}

// Generate refresh token (5 mins)
async function generateRefreshToken(userId) {
  const token = uuidv4();
  // const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
    [uuidv4(), userId, token, expiresAt]
  );

  return token;
}

// Verify access token middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ status: "error", message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Invalid or expired token" });
  }
}

// Require admin role
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ status: "error", message: "Admin access required" });
  }
  next();
}

// Require API version header
function requireApiVersion(req, res, next) {
  const version = req.headers["x-api-version"];
  if (!version) {
    return res.status(400).json({ status: "error", message: "API version header required" });
  }
  next();
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  requireAuth,
  requireAdmin,
  requireApiVersion
};