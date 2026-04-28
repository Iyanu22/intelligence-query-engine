const express = require("express");
const https = require("https");
const { pool } = require("../database");
const { v4: uuidv4 } = require("uuid");
const {
  generateAccessToken,
  generateRefreshToken
} = require("../auth");

const router = express.Router();

// GET /auth/github — redirect to GitHub OAuth
router.get("/github", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/auth/github/callback`,
    scope: "user:email",
    state: uuidv4(),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /auth/github/callback
router.get("/github/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ status: "error", message: "Missing code" });

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code);
     console.log("Token data from GitHub:", JSON.stringify(tokenData));
    if (!tokenData.access_token) {
      return res.status(400).json({ status: "error", message: "Failed to get GitHub token" });
    }

    // Get GitHub user info
    const githubUser = await getGithubUser(tokenData.access_token);

    // Create or update user in database
    const user = await upsertUser(githubUser);

    if (!user.is_active) {
      return res.status(403).json({ status: "error", message: "Account is disabled" });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id);

    return res.status(200).json({
      status: "success",
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "Authentication failed" });
  }
});

// POST /auth/refresh
router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ status: "error", message: "Refresh token required" });
  }

  try {
    // Find refresh token
    const result = await pool.query(
      `SELECT rt.*, u.* FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refresh_token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });
    }

    const row = result.rows[0];

    // Delete old refresh token
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);

    const user = {
      id: row.user_id,
      username: row.username,
      role: row.role,
    };

    // Issue new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user.id);

    return res.status(200).json({
      status: "success",
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "Token refresh failed" });
  }
});

// POST /auth/logout
router.post("/logout", async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);
  }
  return res.status(200).json({ status: "success", message: "Logged out successfully" });
});

// Helper: exchange code for GitHub token
function exchangeCodeForToken(code) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    });

    const options = {
      hostname: "github.com",
      path: "/login/oauth/access_token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Helper: get GitHub user info
function getGithubUser(token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: "/user",
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "InsightaLabs",
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.end();
  });
}

// Helper: create or update user
async function upsertUser(githubUser) {
  const existing = await pool.query(
    `SELECT * FROM users WHERE github_id = $1`,
    [String(githubUser.id)]
  );

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE users SET username=$1, email=$2, avatar_url=$3, last_login_at=NOW()
       WHERE github_id=$4 RETURNING *`,
      [githubUser.login, githubUser.email, githubUser.avatar_url, String(githubUser.id)]
    );
    return updated.rows[0];
  }

  const created = await pool.query(
    `INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
     VALUES ($1,$2,$3,$4,$5,'analyst',true,NOW(),NOW()) RETURNING *`,
    [uuidv4(), String(githubUser.id), githubUser.login, githubUser.email, githubUser.avatar_url]
  );
  return created.rows[0];
}

module.exports = router;