import dotenv from "dotenv";
dotenv.config();

function checkEnvVariable(variableName: string): string {
  const value = process.env[variableName];
  if (!value) {
    throw new Error(`Environment variable ${variableName} is not defined`);
  }
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  nodeEnv: process.env.NODE_ENV ?? "development",
  loglevel: process.env.LOG_LEVEL ?? "info",
  databaseUrl: checkEnvVariable("DATABASE_URL"),
  jwtAccessSecret: checkEnvVariable("JWT_SECRET"),
  jwtAccessExpiresIn: checkEnvVariable("JWT_ACCESS_EXPIRES_IN"),

  // Security
  corsOrigins: list(process.env.CORS_ORIGINS ?? "http://localhost:5173"),
  // Number of reverse proxies in front of the app (needed for correct client IPs in rate limiting)
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),

  // Frontend URL, used to build the password reset link
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  passwordResetExpiresMinutes: Number(
    process.env.PASSWORD_RESET_EXPIRES_MINUTES ?? 15,
  ),

  // Email (Gmail SMTP — SMTP_PASS must be a Google App Password, not your account password)
  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? "",
  },
};
