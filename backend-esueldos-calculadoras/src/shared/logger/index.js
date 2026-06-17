function write(level, args) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logger(`[${level.toUpperCase()}]`, ...args);
}

const logger = {
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
  debug: (...args) => {
    if (process.env.DEBUG_LOGS === "true") write("debug", args);
  }
};

module.exports = logger;
