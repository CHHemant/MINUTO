import { createClient } from "npm:@supabase/supabase-js@2";
import {
  hasValidSignature,
  parseWebhookPayload,
  toApplyPaymentRpcArgs,
} from "./webhook_utils.ts";

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required function secret: ${name}`);
  return value;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  try {
    const rawBody = await request.text();
    const validSignature = await hasValidSignature(
      requiredEnv("YOUPI_WEBHOOK_SECRET"),
      rawBody,
      request.headers.get("X-Gateway-Signature"),
    );
    if (!validSignature) return respond(401, { error: "Invalid gateway signature." });

    let payload;
    try {
      payload = parseWebhookPayload(rawBody);
    } catch {
      return respond(400, { error: "The gateway event is missing required payment fields." });
    }

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await supabase.rpc("apply_youpi_payment_webhook", toApplyPaymentRpcArgs(payload));
    if (error) throw error;

    return respond(200, { received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Could not apply YouPI payment webhook:", message);
    return respond(500, { error: "The payment event could not be applied. Retry delivery later." });
  }
});
