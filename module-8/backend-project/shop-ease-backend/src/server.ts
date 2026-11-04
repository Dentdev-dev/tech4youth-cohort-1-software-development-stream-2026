import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { pool } from "./lib/db.ts";
import { verifyMailer } from "./lib/mailer.ts";
import { registerEmailListeners } from "./events/email.listeners.ts";

registerEmailListeners();
void verifyMailer();

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`server is running on port ${env.port}`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
