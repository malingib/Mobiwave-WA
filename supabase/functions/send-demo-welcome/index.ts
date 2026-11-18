import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Authentication required.");
    
    const body = await readRequestJson(request);
    const { email, workspace_name, workspace_url, demo_days, login_url } = body;
    
    if (!email || !workspace_name || !workspace_url || !demo_days || !login_url) {
      return json({ error: "Missing required fields: email, workspace_name, workspace_url, demo_days, login_url" }, 400);
    }
    
    // Simple email sending using Deno's built-in fetch
    const emailData = {
      to: email,
      subject: `Welcome to your MobiWave WA demo workspace: ${workspace_name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #0a1a25; color: white; padding: 30px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Welcome to MobiWave WA</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Your ${workspace_name} demo workspace is ready!</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin-top: 0; color: #0a1a25; font-size: 18px;">Your Demo Details</h2>
            <ul style="margin: 15px 0; padding-left: 20px; color: #333;">
              <li><strong>Workspace:</strong> ${workspace_name}</li>
              <li><strong>Duration:</strong> ${demo_days} days</li>
              <li><strong>Access:</strong> Full platform access during demo period</li>
            </ul>
          </div>
          
          <div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin-top: 0; color: #0a1a25; font-size: 18px;">Getting Started</h2>
            <ol style="margin: 15px 0; padding-left: 20px; color: #333;">
              <li>Sign in to your workspace: <a href="${login_url}" style="color: #5955d1; text-decoration: none;">${login_url}</a></li>
              <li>Use your email and the temporary password sent to your inbox</li>
              <li>Connect your WhatsApp Business account to start messaging</li>
              <li>Explore all features - no restrictions during your demo!</li>
            </ol>
          </div>
          
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ffeaa7;">
            <h2 style="margin-top: 0; color: #856404; font-size: 18px;">Important Notes</h2>
            <ul style="margin: 15px 0; padding-left: 20px; color: #856404;">
              <li>Your demo will automatically expire after ${demo_days} days</li>
              <li>All data will be deleted when the demo expires</li>
              <li>No credit card required during the demo period</li>
              <li>Want to continue after the demo? Contact our team to convert to a paid plan</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #666; font-size: 14px;">
              Need help? Reply to this email or contact us at info@mobiwave.co.ke
            </p>
            <p style="color: #666; font-size: 12px; margin-top: 10px;">
              This is a demo workspace from MobiWave WA. 
              <a href="https://mobiwave.co.ke" style="color: #5955d1; text-decoration: none;">Learn more</a> about our platform.
            </p>
          </div>
        </div>
      `,
    };
    
    // In a production environment, you would use a proper email service
    // For now, we'll just log the email data and return success
    console.log("Demo welcome email to be sent:", emailData);
    
    // TODO: Integrate with an email service like SendGrid, Mailgun, or Resend
    // For now, return success without actually sending
    return json({ ok: true, message: "Demo welcome email would be sent to " + email });
    
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, 400);
  }
});