import {
  hasValidSignature,
  parseWebhookPayload,
  toApplyPaymentRpcArgs,
} from "./webhook_utils.ts";

Deno.test("parses a retry-suffixed gateway order ID and maps it to the SQL argument", () => {
  const payload = parseWebhookPayload(JSON.stringify({
    event: "SUCCESS",
    orderId: "123e4567-e89b-12d3-a456-426614174000-R2",
    paymentId: "pay_123",
    amountPaise: 10600,
    currency: "INR",
    method: "UPI",
    utr: "utr_123",
  }));

  const args = toApplyPaymentRpcArgs(payload);
  if (args.p_gateway_order_id !== payload.orderId || "p_order_id" in args) {
    throw new Error("The webhook RPC args must use the gateway order ID parameter.");
  }
});

Deno.test("rejects malformed payment amounts and non-UPI payment methods", () => {
  const base = {
    event: "SUCCESS",
    orderId: "123e4567-e89b-12d3-a456-426614174000",
    paymentId: "pay_123",
    amountPaise: 10600,
    currency: "INR",
  };
  for (const value of [
    { ...base, amountPaise: 10600.5 },
    { ...base, method: "CARD" },
  ]) {
    let rejected = false;
    try {
      parseWebhookPayload(JSON.stringify(value));
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalid payment payload was accepted.");
  }
});

Deno.test("accepts a successful webhook when the UTR is omitted or null", () => {
  const base = {
    event: "SUCCESS",
    orderId: "123e4567-e89b-12d3-a456-426614174000",
    paymentId: "pay_123",
    amountPaise: 10600,
    currency: "INR",
  };
  for (const value of [{ ...base }, { ...base, utr: null }]) {
    if (parseWebhookPayload(JSON.stringify(value)).utr !== null) {
      throw new Error("An absent UTR must be normalized to null.");
    }
  }
});

Deno.test("verifies the exact raw-body HMAC and rejects altered bodies", async () => {
  const secret = "test-webhook-secret";
  const rawBody = '{"event":"SUCCESS"}';
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  ));
  const signatureHex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!await hasValidSignature(secret, rawBody, `sha256=${signatureHex}`)) {
    throw new Error("Valid signature was rejected.");
  }
  if (await hasValidSignature(secret, `${rawBody} `, `sha256=${signatureHex}`)) {
    throw new Error("Signature verification accepted an altered body.");
  }
  if (await hasValidSignature(secret, rawBody, "sha256=not-a-signature")) {
    throw new Error("Malformed signature was accepted.");
  }
});
