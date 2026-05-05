const isDevelopment =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

export const logger = {
  info: (message: string, data?: unknown) => {
    if (isDevelopment) console.log(`[INFO] ${message}`, data ?? "");
  },
  warn: (message: string, data?: unknown) => {
    if (isDevelopment) console.warn(`[WARN] ${message}`, data ?? "");
  },
  error: (message: string, error?: unknown) => {
    console.error(`[ERROR] ${message}`, error ?? "");
  },
  debug: (message: string, data?: unknown) => {
    if (isDevelopment) console.debug(`[DEBUG] ${message}`, data ?? "");
  },
};
