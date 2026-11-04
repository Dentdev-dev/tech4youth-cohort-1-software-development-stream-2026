import { eventBus } from "./eventBus.ts";
import { sendMail } from "../lib/mailer.ts";
import { logger } from "../lib/logger.ts";
import * as templates from "../emails/templates.ts";
import type { EmailContent } from "../emails/templates.ts";

/**
 * EventEmitter does not await listeners, so a rejected promise would become an
 * unhandled rejection. Wrap every send so failures are logged, never thrown.
 */
function deliver(to: string, content: EmailContent, event: string): void {
  sendMail({ to, ...content }).catch((err: unknown) => {
    logger.error({ err, to, event }, "failed to send email");
  });
}

let registered = false;

export function registerEmailListeners(): void {
  if (registered) return;
  registered = true;

  eventBus.on("user.registered", ({ name, email }) => {
    deliver(email, templates.welcomeEmail(name), "user.registered");
  });

  eventBus.on(
    "password.resetRequested",
    ({ name, email, resetUrl, expiresInMinutes }) => {
      deliver(
        email,
        templates.passwordResetEmail(name, resetUrl, expiresInMinutes),
        "password.resetRequested",
      );
    },
  );

  eventBus.on("password.changed", ({ name, email }) => {
    deliver(email, templates.passwordChangedEmail(name), "password.changed");
  });

  eventBus.on("order.created", ({ name, email, order }) => {
    deliver(email, templates.orderCreatedEmail(name, order), "order.created");
  });

  eventBus.on("order.statusChanged", ({ name, email, order }) => {
    deliver(
      email,
      templates.orderStatusEmail(name, order),
      "order.statusChanged",
    );
  });
}
