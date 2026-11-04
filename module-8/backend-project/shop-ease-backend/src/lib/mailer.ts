import nodemailer from "nodemailer";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const isConfigured = Boolean(env.smtp.user && env.smtp.pass);

// Gmail SMTP: smtp.gmail.com:465 over TLS, authenticated with a Google App Password.
const transporter = isConfigured
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    })
  : null;

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendMail(message: MailMessage): Promise<void> {
  if (!transporter) {
    logger.warn(
      { to: message.to, subject: message.subject },
      "SMTP not configured (SMTP_USER/SMTP_PASS); email not sent",
    );
    if (!env.isProduction) logger.debug(message.text);
    return;
  }

  const info = await transporter.sendMail({ from: env.smtp.from, ...message });
  logger.info({ to: message.to, messageId: info.messageId }, "email sent");
}

/** Checks the SMTP connection at startup so misconfiguration shows up early. */
export async function verifyMailer(): Promise<void> {
  if (!transporter) {
    logger.warn("SMTP not configured; emails will be logged instead of sent");
    return;
  }
  try {
    await transporter.verify();
    logger.info("SMTP connection verified");
  } catch (err) {
    logger.error({ err }, "SMTP connection failed");
  }
}
