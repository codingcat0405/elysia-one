import winston from "winston";
const { combine, timestamp, printf, colorize, errors, json } = winston.format;
const isProd = process.env.NODE_ENV === "production";

// Pretty, colorized format for local dev
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }), // log full stack traces for Error objects
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${stack || message}${extra}`;
  }),
);

// Structured JSON for production (machine-parseable for log aggregators)
const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  format: isProd ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
});

export default logger;