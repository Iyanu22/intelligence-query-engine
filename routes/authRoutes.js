const crypto = require("crypto");

// Store state temporarily (in production use Redis/DB)
const stateStore = new Map();

function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  return { codeVerifier, codeChallenge, state };
}

// GET /auth/github
router.get("/github", (req, res) => {
  const { codeVerifier, codeChallenge, state } = generatePKCE();
  stateStore.set(state, { codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/auth/github/callback`,
    scope: "user:email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /auth/github/callback
router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ status: "error", message: "Missing code" });
  if (!state) return res.status(400).json({ status: "error", message: "Missing state" });

  const stored = stateStore.get(state);
  if (!stored) return res.status(400).json({ status: "error", message: "Invalid or expired state" });

  stateStore.delete(state);
  const { codeVerifier } = stored;

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
        detail: tokenData
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
      }
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ status: "error", message: "Authentication failed", detail: err.message });
  }
});