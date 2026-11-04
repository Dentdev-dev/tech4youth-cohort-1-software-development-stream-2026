import { EventEmitter } from "node:events";
import type { Order } from "../types/order.ts";

type Recipient = { name: string; email: string };

/** Every app event and the payload it carries. */
export type AppEvents = {
  "user.registered": [Recipient];
  "password.resetRequested": [
    Recipient & { resetUrl: string; expiresInMinutes: number },
  ];
  "password.changed": [Recipient];
  "order.created": [Recipient & { order: Order }];
  "order.statusChanged": [Recipient & { order: Order }];
};

/**
 * Typed, app-wide event bus. Services emit events and return immediately;
 * listeners (e.g. email) run asynchronously so a slow SMTP server never
 * blocks an HTTP response.
 */
class AppEventBus extends EventEmitter<AppEvents> {}

export const eventBus = new AppEventBus();
