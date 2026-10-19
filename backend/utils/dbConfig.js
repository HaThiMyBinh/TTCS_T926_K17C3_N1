const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE = path.join(__dirname, "..", "db_config.json");
const DEFAULT_CONFIG = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "user_management",
};

function readDbConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch {
      fileConfig = {};
    }
  }
  return {
    host: process.env.DB_HOST || fileConfig.host || DEFAULT_CONFIG.host,
    port: Number(process.env.DB_PORT) || fileConfig.port || DEFAULT_CONFIG.port,
    user: process.env.DB_USER || fileConfig.user || DEFAULT_CONFIG.user,
    password:
      process.env.DB_PASSWORD ?? fileConfig.password ?? DEFAULT_CONFIG.password,
    database:
      process.env.DB_NAME || fileConfig.database || DEFAULT_CONFIG.database,
  };
}

module.exports = { readDbConfig };
