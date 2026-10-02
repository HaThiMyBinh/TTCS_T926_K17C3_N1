const { authenticateToken } = require("../auth");

const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/health",
];

function apiAuthentication(req, res, next) {
  if (!req.path.startsWith("/api/") || PUBLIC_API_PATHS.includes(req.path)) {
    return next();
  }

  return authenticateToken(req, res, next);
}

module.exports = apiAuthentication;
