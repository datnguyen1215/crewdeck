import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.port, config.host, () => {
  logger.info(`Server started on port ${config.port}`);
});

// Graceful shutdown
function shutdown() {
  db.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
