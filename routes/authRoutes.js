const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { pool } = require("../database");
const { v4: uuidv4 } = require("uuid");
const { generateAccessToken, generateRefreshToken } = require("../auth");

const router = express.Router();

function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  return { codeVerifier, codeChallenge, state };
}

// GET /auth/github
router.get("/github", (req, res) => {
  const { codeVerifier, codeChallenge, state } = generatePKCE();

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/auth/github/callback`,
    scope: "user:email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  // Store codeVerifier in state cookie
  res.cookie("pkce_verifier", codeVerifier, {
    httpOnly: true,
    maxAge: 5 * 60 * 1000,
    sameSite: "lax",
  });
  res.cookie("oauth_state", state, {
    httpOnly: true,
    maxAge: 5 * 60 * 1000,
    sameSite: "lax",
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /auth/github/callback
router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ status: "error", message: "Missing code" });
  }
  if (!state) {
    return res.status(400).json({ status: "error", message: "Missing state" });
  }

  const storedState = req.cookies?.oauth_state;
  const codeVerifier = req.cookies?.pkce_verifier;

  if (!storedState || storedState !== state) {
    return res.status(400).json({ status: "error", message: "Invalid state" });
  }

  if (!codeVerifier) {
    return res.status(400).json({ status: "error", message: "Missing code verifier" });
  }

  // Clear PKCE cookies
  res.clearCookie("pkce_verifier");
  res.clearCookie("oauth_state");

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return res.status(400).json({
        status: "error",
        message: "Failed to get GitHub token",
        detail: tokenData,
      });
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "InsightaLabs",
        Accept: "application/json",
      },
    });

    const githubUser = await userResponse.json();
    const user = await upsertUser(githubUser);

    if (!user.is_active) {
      return res.status(403).json({ status: "error", message: "Account is disabled" });
    }

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
      },
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ status: "error", message: "Authentication failed", detail: err.message });
  }
});

// POST /auth/refresh
router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ status: "error", message: "Refresh token required" });
  }

  try {
    const result = await pool.query(
      `SELECT rt.*, u.id as user_id, u.username, u.role FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refresh_token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });
    }

    const row = result.rows[0];
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);

    const user = { id: row.user_id, username: row.username, role: row.role };
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