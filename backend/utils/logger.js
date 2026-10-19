// Logger tối giản: lọc theo LOG_LEVEL (debug | info | warn | error | silent).
// Mặc định "info". Đặt LOG_LEVEL=warn để ẩn log khởi động trên môi trường thật.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  const name = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[name] ?? LEVELS.info;
}

const logger = {
  debug: (...args) => currentLevel() <= LEVELS.debug && console.debug(...args),
  info: (...args) => currentLevel() <= LEVELS.info && console.log(...args),
  warn: (...args) => currentLevel() <= LEVELS.warn && console.warn(...args),
  error: (...args) => currentLevel() <= LEVELS.error && console.error(...args),
};

module.exports = logger;
