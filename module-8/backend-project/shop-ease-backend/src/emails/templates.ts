import type { Order } from "../types/order.ts";

export type EmailContent = { subject: string; html: string; text: string };

/** Escape user-supplied values before putting them in HTML (prevents HTML/XSS injection in emails). */
function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (n: number) => `$${n.toFixed(2)}`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;padding:24px">
    <h2 style="margin-top:0">${esc(title)}</h2>
    ${body}
    <p style="color:#888;font-size:12px;margin-top:32px">This is an automated message, please do not reply.</p>
  </div>
</body></html>`;
}

export function welcomeEmail(name: string): EmailContent {
  return {
    subject: "Welcome to our store!",
    html: layout(
      `Welcome, ${name}!`,
      `<p>Your account has been created. You can now browse products and place orders.</p>`,
    ),
    text: `Welcome, ${name}! Your account has been created.`,
  };
}

export function passwordResetEmail(
  name: string,
  resetUrl: string,
  expiresInMinutes: number,
): EmailContent {
  return {
    subject: "Reset your password",
    html: layout(
      "Password reset request",
      `<p>Hi ${esc(name)},</p>
       <p>We received a request to reset your password. Click the button below to choose a new one.</p>
       <p><a href="${esc(resetUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset password</a></p>
       <p>This link expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email.</p>`,
    ),
    text: `Hi ${name},\n\nReset your password using this link (expires in ${expiresInMinutes} minutes):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  };
}

export function passwordChangedEmail(name: string): EmailContent {
  return {
    subject: "Your password was changed",
    html: layout(
      "Password changed",
      `<p>Hi ${esc(name)},</p>
       <p>Your password was just changed and all other sessions were signed out.</p>
       <p>If this wasn't you, reset your password immediately.</p>`,
    ),
    text: `Hi ${name}, your password was just changed. If this wasn't you, reset your password immediately.`,
  };
}

function itemsTable(order: Order): string {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td>${esc(i.productName)}</td><td align="center">${i.quantity}</td><td align="right">${money(i.subtotal)}</td></tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="6" style="border-collapse:collapse">
    <tr style="background:#f0f0f0"><th align="left">Item</th><th>Qty</th><th align="right">Subtotal</th></tr>
    ${rows}
    <tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>${money(order.totalAmount)}</b></td></tr>
  </table>`;
}

export function orderCreatedEmail(name: string, order: Order): EmailContent {
  return {
    subject: `Order confirmation #${order.id.slice(0, 8)}`,
    html: layout(
      "Thanks for your order!",
      `<p>Hi ${esc(name)}, we've received your order <b>#${esc(order.id.slice(0, 8))}</b>.</p>
       ${itemsTable(order)}`,
    ),
    text: `Hi ${name}, we've received your order #${order.id.slice(0, 8)}. Total: ${money(order.totalAmount)}.`,
  };
}

export function orderStatusEmail(name: string, order: Order): EmailContent {
  const status = order.status.toLowerCase();
  return {
    subject: `Your order #${order.id.slice(0, 8)} is ${status}`,
    html: layout(
      "Order update",
      `<p>Hi ${esc(name)}, your order <b>#${esc(order.id.slice(0, 8))}</b> is now <b>${esc(status)}</b>.</p>
       ${itemsTable(order)}`,
    ),
    text: `Hi ${name}, your order #${order.id.slice(0, 8)} is now ${status}.`,
  };
}
