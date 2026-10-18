export type YouPiWebhookPayload = {
  event: "SUCCESS" | "FAILED" | "EXPIRED" | "CANCELLED";
  orderId: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  utr: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function hasValidSignature(
  secret: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const signatureHex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const signature = Uint8Array.from(
    signatureHex.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signature),
    toArrayBuffer(new TextEncoder().encode(rawBody)),
  );
}

export function parseWebhookPayload(rawBody: string): YouPiWebhookPayload {
  const value: unknown = JSON.parse(rawBody);
  if (!isRecord(value)
    || !["SUCCESS", "FAILED", "EXPIRED", "CANCELLED"].includes(String(value.event))
    || typeof value.orderId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(-R[0-9]{1,10})?$/i.test(value.orderId)
    || typeof value.paymentId !== "string"
    || value.paymentId.length === 0
    || typeof value.amountPaise !== "number"
    || !Number.isSafeInteger(value.amountPaise)
    || value.amountPaise < 1
    || typeof value.currency !== "string"
    || (value.event === "SUCCESS" && value.currency !== "INR")
    || (value.method !== undefined && value.method !== "UPI")
    || (value.utr !== undefined && value.utr !== null && typeof value.utr !== "string")) {
    throw new Error("Invalid YouPI webhook payload.");
  }
  return {
    event: value.event as YouPiWebhookPayload["event"],
    orderId: value.orderId,
    paymentId: value.paymentId,
    amountPaise: value.amountPaise,
    currency: value.currency,
    utr: typeof value.utr === "string" ? value.utr : null,
  };
}

export function toApplyPaymentRpcArgs(payload: YouPiWebhookPayload) {
  return {
    p_event: payload.event,
    p_gateway_order_id: payload.orderId,
    p_payment_id: payload.paymentId,
    p_amount_paise: payload.amountPaise,
    p_currency: payload.currency,
    p_utr: payload.utr,
  };
}
