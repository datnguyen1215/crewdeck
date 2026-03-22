import pino from "pino";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

// Ensure log directory exists
const logDir = path.dirname(config.logFilePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const targets: pino.TransportTargetOptions[] = [
  // File transport with rotation (JSON format)
  {
    target: "pino-roll",
    options: {
      file: config.logFilePath,
      frequency: "daily",
      limit: { count: 5 },
      size: "10m",
    },
    level: config.logLevel,
  },
];

// Add console output
if (config.nodeEnv === "development") {
  // Pretty output in development
  targets.push({
    target: "pino-pretty",
    options: { colorize: true },
    level: config.logLevel,
  });
} else {
  // Plain stdout in production
  targets.push({
    target: "pino/file",
    options: { destination: 1 },
    level: config.logLevel,
  });
}

export const logger = pino(
  { level: config.logLevel },
  pino.transport({ targets }),
);
