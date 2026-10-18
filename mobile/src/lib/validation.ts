export function validateSupabaseConfig(rawUrl: string, rawKey: string) {
  const url = rawUrl.trim().replace(/\/+$/, "");
  const key = rawKey.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a valid Supabase project URL.");
  }

  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("Enter an HTTPS Supabase project URL ending in .supabase.co.");
  }
  if (!(key.startsWith("sb_publishable_") || key.startsWith("eyJ"))) {
    throw new Error("Enter a Supabase publishable/anon key, not a secret key.");
  }

  return { url, key };
}

export function normalizeIndianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const phone = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error("Enter a valid 10-digit Indian mobile number.");
  }
  return phone;
}

export function validateSellerPaymentDetails(upiId: string, phone: string) {
  const normalizedUpiId = upiId.trim();
  if (!/^[A-Z0-9][A-Z0-9._+-]{1,63}@[A-Z0-9][A-Z0-9.-]{1,63}$/i.test(normalizedUpiId)) {
    throw new Error("Enter a valid UPI ID, such as name@bank.");
  }

  return {
    upiId: normalizedUpiId,
    phone: normalizeIndianPhone(phone),
  };
}
