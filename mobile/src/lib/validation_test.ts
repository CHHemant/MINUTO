import {
  normalizeIndianPhone,
  validateSellerPaymentDetails,
  validateSupabaseConfig,
} from "./validation.ts";

Deno.test("validates and normalizes Supabase configuration", () => {
  const config = validateSupabaseConfig(
    " https://example.supabase.co/ ",
    " sb_publishable_demo ",
  );
  if (config.url !== "https://example.supabase.co" || config.key !== "sb_publishable_demo") {
    throw new Error("Supabase configuration was not normalized.");
  }
});

Deno.test("rejects unsafe Supabase configuration", () => {
  for (const [url, key] of [
    ["http://example.supabase.co", "sb_publishable_demo"],
    ["https://example.supabase.co", "service_role_secret"],
  ]) {
    let rejected = false;
    try {
      validateSupabaseConfig(url, key);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Unsafe Supabase configuration was accepted.");
  }
});

Deno.test("normalizes valid Indian phone numbers", () => {
  if (normalizeIndianPhone("+91 98765 43210") !== "9876543210") {
    throw new Error("Indian phone number was not normalized.");
  }
});

Deno.test("validates seller payout details", () => {
  const details = validateSellerPaymentDetails(" seller@bank ", "9876543210");
  if (details.upiId !== "seller@bank" || details.phone !== "9876543210") {
    throw new Error("Seller payment details were not normalized.");
  }
});
