import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required function secret: ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  try {
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return respond(401, { error: "Sign in before checking payment status." });

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return respond(401, { error: "Your session is no longer valid. Sign in again." });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond(400, { error: "Send a valid JSON request." });
    }
    if (!isRecord(body)
      || typeof body.orderId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)) {
      return respond(400, { error: "A valid order ID is required." });
    }

    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id,buyer_id,total,payment_method,payment_status,youpi_payment_id,youpi_order_id")
      .eq("id", body.orderId)
      .eq("buyer_id", userData.user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return respond(404, { error: "Order not found." });
    if (order.payment_method !== "upi") return respond(409, { error: "This order was not placed with UPI." });
    if (order.payment_status !== "pending") return respond(200, { status: order.payment_status });
    if (!order.youpi_payment_id || !order.youpi_order_id) {
      return respond(200, { status: "pending", message: "Checkout has not returned a payment session yet." });
    }

    const gatewayBase = new URL(requiredEnv("YOUPI_API_URL"));
    if (gatewayBase.protocol !== "https:") throw new Error("YOUPI_API_URL must use HTTPS.");
    const statusResponse = await fetch(
      `${gatewayBase.toString().replace(/\/+$/, "")}/api/v1/payments/${encodeURIComponent(order.youpi_payment_id)}`,
      {
        headers: { "X-Merchant-Id": requiredEnv("YOUPI_MERCHANT_ID") },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const rawStatus = await statusResponse.text();
    let payment: unknown;
    try {
      payment = JSON.parse(rawStatus);
    } catch {
      throw new Error(`YouPI returned an invalid status response (HTTP ${statusResponse.status}).`);
    }
    if (!statusResponse.ok) {
      throw new Error(`YouPI could not retrieve payment status (HTTP ${statusResponse.status}).`);
    }
    if (!isRecord(payment)
      || payment.paymentId !== order.youpi_payment_id
      || payment.orderId !== order.youpi_order_id
      || payment.currency !== "INR"
      || !["number", "string"].includes(typeof payment.amountPaise)
      || !/^[0-9]+$/.test(String(payment.amountPaise))
      || BigInt(String(payment.amountPaise)) !== BigInt(order.total) * 100n
      || typeof payment.status !== "string") {
      throw new Error("YouPI returned payment details that do not match this order.");
    }
    const amountPaise = BigInt(String(payment.amountPaise));
    if (amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("YouPI returned an unsupported payment amount.");
    }

    const eventByStatus: Record<string, string> = {
      SUCCESS: "SUCCESS",
      FAILED: "FAILED",
      EXPIRED: "EXPIRED",
      CANCELLED: "CANCELLED",
    };
    const event = eventByStatus[payment.status];
    if (event) {
      const { error: applyError } = await supabase.rpc("apply_youpi_payment_webhook", {
        p_event: event,
        p_gateway_order_id: payment.orderId,
        p_payment_id: payment.paymentId,
        p_amount_paise: Number(amountPaise),
        p_currency: payment.currency,
        p_utr: typeof payment.utr === "string" ? payment.utr : null,
      });
      if (applyError) throw applyError;
    }

    const { data: updatedOrder, error: updatedOrderError } = await supabase.from("orders")
      .select("payment_status,payment_review_required")
      .eq("id", order.id)
      .single();
    if (updatedOrderError) throw updatedOrderError;
    return respond(200, {
      status: updatedOrder.payment_status,
      reviewRequired: updatedOrder.payment_review_required,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Could not synchronize YouPI payment status:", message);
    return respond(500, { error: "Could not verify payment status right now. Try again before making another payment." });
  }
});
