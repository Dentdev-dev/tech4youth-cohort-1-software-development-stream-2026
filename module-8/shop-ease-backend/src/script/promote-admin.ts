// Usage: pnpm promote-admin user@example.com
import { pool } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { setUserRole } from "../repository/user.repository.ts";

const email = process.argv[2];

async function main(): Promise<void> {
  if (!email) {
    logger.error("Usage: pnpm promote-admin <email>");
    process.exitCode = 1;
    return;
  }
  const updated = await setUserRole(email, "ADMIN");
  if (updated) {
    logger.info(`${email} is now an ADMIN (log in again to get an admin token)`);
  } else {
    logger.error(`No user found with email ${email}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    logger.error({ err }, "failed to promote user");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
