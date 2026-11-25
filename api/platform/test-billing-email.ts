import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const TEST_RECIPIENT = "sales@mobiwave.co.ke";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: "Platform authentication is not configured" });
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid or expired session" });

  // This owner-only RPC is the server-side authorization gate. Its result is
  // deliberately discarded; no customer billing data is returned by this API.
  const { error: permissionError } = await client.rpc("platform_billing_data");
  if (permissionError) return res.status(403).json({ error: "Platform owner access required" });

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.DUNNING_EMAIL_FROM ?? "MobiWave WA <no-reply@mobiwave.co.ke>";
  if (!host || port !== 587 || !user || !pass || !EMAIL_RE.test(TEST_RECIPIENT)) {
    return res.status(503).json({ error: "SMTP is not configured for STARTTLS on port 587" });
  }

  const transporter = nodemailer.createTransport({
    host, port, secure: false, auth: { user, pass }, requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });

  try {
    await transporter.sendMail({
      from,
      to: TEST_RECIPIENT,
      subject: "MobiWave WA — SMTP delivery test",
      text: "This is a test message from the MobiWave WA platform administration console. SMTP delivery via STARTTLS on port 587 is working.",
      html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#172033\"><h2>MobiWave WA email test</h2><p>This is a test message initiated from the platform administration console.</p><p>SMTP delivery via STARTTLS on port 587 is working.</p><p style=\"color:#64748b;font-size:12px\">No customer billing records or subscription settings were changed.</p></div>",
      messageId: `<smtp-test-${authData.user.id}-${Date.now()}@mobiwave.co.ke>`,
    });
    return res.status(200).json({ success: true, recipient: TEST_RECIPIENT });
  } catch (error) {
    console.error("[platform-smtp-test] Delivery failed", error);
    return res.status(502).json({ error: "SMTP delivery failed. Check the server mail logs." });
  } finally {
    transporter.close();
  }
}
