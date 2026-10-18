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
    const authorization = request.headers.get("Authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return respond(401, { error: "Sign in before starting checkout." });

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
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
      .select("id,buyer_id,total,payment_method,payment_status,youpi_payment_id,youpi_order_id,youpi_checkout_url,youpi_attempt_number")
      .eq("id", body.orderId)
      .eq("buyer_id", userData.user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return respond(404, { error: "Order not found." });
    if (order.payment_method !== "upi") {
      return respond(409, { error: "This order was not placed with UPI." });
    }
    let paymentId = order.youpi_payment_id as string | null;
    let checkoutUrl = order.youpi_checkout_url as string | null;
    let attemptNumber = order.youpi_attempt_number as number;
    if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
      throw new Error("The UPI attempt counter is invalid. Contact Minuto support.");
    }
    if (["failed", "expired", "cancelled"].includes(order.payment_status)) {
      const { error: retryError } = await supabase.rpc("prepare_youpi_payment_retry", {
        p_order_id: order.id,
        p_buyer_id: userData.user.id,
      });
      if (retryError) throw retryError;
      paymentId = null;
      checkoutUrl = null;
      const { data: retriedOrder, error: retriedOrderError } = await supabase.from("orders")
        .select("youpi_attempt_number")
        .eq("id", order.id)
        .eq("buyer_id", userData.user.id)
        .single();
      if (retriedOrderError) throw retriedOrderError;
      attemptNumber = retriedOrder.youpi_attempt_number;
    } else if (order.payment_status !== "pending") {
      return respond(409, { error: "This order is not waiting for UPI payment." });
    }
    if (paymentId && checkoutUrl) {
      return respond(200, { paymentId, checkoutUrl });
    }

    const gatewayBase = new URL(requiredEnv("YOUPI_API_URL"));
    if (gatewayBase.protocol !== "https:") throw new Error("YOUPI_API_URL must use HTTPS.");
    const merchantId = requiredEnv("YOUPI_MERCHANT_ID");
    const gatewayResponse = await fetch(`${gatewayBase.toString().replace(/\/+$/, "")}/api/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Merchant-Id": merchantId,
        "Idempotency-Key": `minuto-${order.id}-${attemptNumber}`,
      },
      body: JSON.stringify({
        orderId: order.id,
        amount: Number(order.total).toFixed(2),
        currency: "INR",
        description: `Minuto order ${order.id}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const gatewayBody = await gatewayResponse.text();
    let payment: unknown;
    try {
      payment = JSON.parse(gatewayBody);
    } catch {
      throw new Error(`YouPI returned an invalid response (HTTP ${gatewayResponse.status}).`);
    }
    if (!gatewayResponse.ok) {
      throw new Error(`YouPI checkout request failed (HTTP ${gatewayResponse.status}).`);
    }
    if (!isRecord(payment)
      || typeof payment.paymentId !== "string"
      || typeof payment.orderId !== "string"
      || !new RegExp(`^${order.id}(-R[0-9]{1,10})?$`, "i").test(payment.orderId)
      || typeof payment.checkoutUrl !== "string"
      || !payment.checkoutUrl.startsWith("https://")
      || payment.currency !== "INR"
      || !["number", "string"].includes(typeof payment.amountPaise)
      || !/^[0-9]+$/.test(String(payment.amountPaise))
      || BigInt(String(payment.amountPaise)) !== BigInt(order.total) * 100n) {
      throw new Error("YouPI returned an incomplete or insecure payment session.");
    }

    const { error: saveError } = await supabase.rpc("record_youpi_payment_session", {
      p_order_id: order.id,
      p_payment_id: payment.paymentId,
      p_gateway_order_id: payment.orderId,
      p_checkout_url: payment.checkoutUrl,
    });
    if (saveError) throw saveError;

    return respond(200, { paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Could not create YouPI checkout session:", message);
    return respond(500, { error: "Could not safely open checkout. Check the order status before trying again." });
  }
});
