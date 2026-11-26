import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import { timingSafeEqual } from "node:crypto";

function authorized(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = new Uint8Array(Buffer.from(provided));
  const b = new Uint8Array(Buffer.from(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req.headers.authorization?.replace(/^Bearer\s+/i, ""), process.env.DUNNING_EMAIL_RELAY_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { to, subject, html, idempotencyKey } = req.body ?? {};
  if (
    typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ||
    typeof subject !== "string" || subject.length < 1 || subject.length > 240 ||
    typeof html !== "string" || html.length < 1 || html.length > 100_000 ||
    typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{1,180}$/.test(idempotencyKey)
  ) return res.status(400).json({ error: "Invalid email payload" });

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.DUNNING_EMAIL_FROM ?? "MobiWave WA <no-reply@mobiwave.co.ke>";
  if (!host || port !== 587 || !user || !pass) {
    return res.status(503).json({ error: "SMTP is not configured for STARTTLS on port 587" });
  }

  const transporter = nodemailer.createTransport({
    host, port, secure: false,
    auth: { user, pass },
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await transporter.sendMail({
      from, to, subject, html,
      messageId: `<${idempotencyKey}@mobiwave.co.ke>`,
      headers: { "X-MobiWave-Dunning-Key": idempotencyKey },
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[dunning-email-relay] SMTP delivery failed", error);
    return res.status(502).json({ error: "SMTP delivery failed" });
  } finally {
    transporter.close();
  }
}
