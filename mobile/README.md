# Minuto Mobile and Backend Implementation Guide

For the project overview, product rationale, architecture, installation, security model, testing checklist, limitations, and launch requirements, see the repository [README.md](../README.md). This file contains the mobile-specific backend and deployment details.

Minuto is an Expo / React Native marketplace for independent vendors in Nagpur. It supports buyer, vendor, and delivery-agent roles. Supabase provides shared accounts, catalog, image storage, orders, and live delivery-job updates. Authentication sessions are persisted on each phone.

## Set up the shared backend

1. Create a Supabase project.
2. Open its **SQL Editor** and run `supabase/schema.sql` once. This creates the app schema, security policies, order and delivery functions, product-image bucket, and Realtime tables.
3. Run `supabase/migrations/20261018_vendor_payment_details.sql` after the base schema. Sellers must save their UPI ID and phone before their listings can be seen by buyers or included in orders.
4. To enable YouPI UPI checkout, run `supabase/migrations/20261018_youpi_upi_payments.sql`. This adds payment state, order reservation handling, and the protected webhook RPCs.
5. Run `supabase/migrations/20261018_youpi_upi_reliability.sql`. It tracks individual gateway attempts, supports safe retries and payment-status reconciliation, creates private seller payout records, and records payments requiring manual review.
6. Run `supabase/migrations/20261018_marketplace_admin_approval.sql` last. It gates vendor and delivery-agent access behind approval, creates the private finance admin allowlist, and adds audited in-app review and manual settlement controls. Existing vendor and agent accounts will require review again.
7. Run `supabase/migrations/20261022_daily_life_services.sql` to add verified service providers, buyer service bookings, saved addresses, and life reminders. Finance administrators can onboard providers in the app; provider rows remain inactive until the team verifies and publishes them.
8. Run `supabase/migrations/20261022_service_reviews.sql` to enable one rating and review per completed service and provider rating updates.
9. Run `supabase/migrations/20261022_service_booking_controls.sql` to allow buyers to cancel requested or confirmed service bookings.
10. Run `supabase/migrations/20261022_profile_recovery.sql` to repair profiles for Auth users created before the signup trigger or accounts whose profile row is missing.
11. Run `supabase/migrations/20261022_admin_trust_controls.sql` to enable one-time seller/agent invite codes, account suspension and permanent bans, and the protected admin account-management view.
12. Run `supabase/migrations/20261022_delivery_tracking.sql` to add optional pickup/drop-off coordinates and secure latest delivery-agent location updates.
13. Run `supabase/migrations/20261022_delivery_proof.sql` to require a buyer delivery code before completion and store optional delivery notes and proof photos.
14. Run `supabase/migrations/20261022_delivery_notifications.sql` to create durable delivery notifications for buyers, sellers, and agents.

### Delivery-agent UI preview

To work on the delivery-agent interface without signing in during development, add `EXPO_PUBLIC_AGENT_PREVIEW=true` to `.env.local` and restart Expo. This shows local sample delivery jobs only; it does not connect to Supabase, bypass production authorization, or change the login flow. Remove the variable or set it to `false` before testing real agent accounts.

### Authentication email delivery

Signup confirmation emails are sent by Supabase Auth, not by the mobile app. For local development, either turn off **Confirm email** under **Authentication → Providers → Email** (so signup signs in immediately), or configure a real SMTP provider under **Authentication → SMTP Settings**. The default Supabase sender is intended for development and may be rate-limited or suppressed.

Add `http://localhost:8081` under **Authentication → URL Configuration → Redirect URLs**. For a deployed build, add the exact HTTPS app URL as well. If the app reports that a resend was sent but no message arrives, check the Supabase Auth logs, spam/quarantine folders, sender-domain verification, and SMTP quota before changing app code.

Minuto also supports password recovery from the sign-in screen. The reset link must use the same allowed redirect URL; after opening it, the app displays a secure new-password form.
7. After the finance operator has a confirmed Supabase Auth account, add the operator explicitly from the Supabase SQL Editor:

   ```sql
   insert into public.finance_admin_allowlist (email)
   values (lower('finance-operator@example.com'))
   on conflict (email) do nothing;
   ```

   Finance access is determined server-side; a client-selected role cannot grant it. Do not commit the operator email or any service-role credential in source control.
8. In the Supabase project settings, copy the **Project URL** and the **publishable key** (or legacy anon key). Never put a `service_role` or secret key in a mobile app.
9. Either enter those values in the app's first-run setup screen, or create `.env.local` in this directory from `.env.example`:

   ```text
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your_key
   ```

10. Install dependencies with `npm ci`, then start the development app with `npx expo start`.

For a shared marketplace, each phone must connect to the same Supabase project. Phone-only storage cannot keep different buyers, vendors, and agents in sync.

## Enable YouPI UPI checkout

Minuto opens YouPI's hosted checkout in the device browser. The app never decides that a payment succeeded: a signed YouPI webhook must first pass HMAC verification and match the order ID, payment ID, currency, and exact amount. Delivery jobs are created only after that verification. COD checkout remains available.

The YouPI merchant account has one configured receiving UPI account. Buyer payments therefore go to Minuto's configured account, not directly to each seller. Seller UPI ID and phone are collected for Minuto to pay sellers separately; this app does not automatically transfer funds. The details are self-entered, not independently verified, and not visible to buyers. UPI checkout snapshots the seller's payout details for the order so later profile edits do not redirect an existing payout. Sellers must save both details before their listings are visible or can be ordered.

The seller UPI ID is not a buyer checkout destination and is not converted into a payment QR code. Do not mark an order paid from a seller-provided UPI ID, QR scan, browser redirect, or client-side callback; only the signed webhook or authenticated server-side status lookup can do that.

Minuto's existing charges remain: ₹5 markup per item, ₹6 buyer delivery contribution per order, and ₹6 seller delivery contribution per vendor delivery. The UPI seller payout ledger records seller-price total less the ₹6 seller delivery contribution for each vendor; if that leaves zero or less, no payout is due for that vendor on that order. The ledger is not an automatic transfer system. YouPI advertises zero gateway platform fees, but independently confirm its commercial terms and any bank, hosting, tax, or other charges; Minuto cannot promise that all transactions have zero charges.

1. Deploy YouPI separately using its own deployment and commercial license terms. Configure its public HTTPS checkout/API URL, merchant ID, and webhook secret in its merchant settings.
2. From this directory, deploy the Supabase Edge Functions. Keep the webhook function's JWT verification disabled because YouPI authenticates it with its HMAC signature; the payment-creation function still requires the signed-in user's JWT:

   ```powershell
   supabase functions deploy create-youpi-payment --project-ref <project-ref>
   supabase functions deploy sync-youpi-payment --project-ref <project-ref>
   supabase functions deploy youpi-webhook --no-verify-jwt --project-ref <project-ref>
   ```

3. Configure the Edge Function secrets in Supabase. The Supabase service-role key is supplied to Edge Functions by Supabase; never add it to the app or source files.

   ```powershell
   supabase secrets set YOUPI_API_URL=https://pay.example.com YOUPI_MERCHANT_ID=<merchant-id> YOUPI_WEBHOOK_SECRET=<webhook-secret> --project-ref <project-ref>
   ```

4. In YouPI's merchant webhook configuration, set the webhook URL to `https://<project-ref>.supabase.co/functions/v1/youpi-webhook` and use the same webhook secret as `YOUPI_WEBHOOK_SECRET`.
5. Test the full hosted-checkout, retry, delayed webhook, amount mismatch, duplicate payment, and refund/reconciliation flows in a non-production environment before accepting live payments. Without all migrations, deployed functions, a publicly reachable HTTPS YouPI instance, and a working webhook, UPI orders will not complete.

### Seller approval, manual payouts, and payment review

Vendor and delivery-agent accounts remain pending until an allowlisted finance administrator reviews and records a verification note. Rejected users can correct details and request another review. Pending accounts cannot publish listings, appear in buyer search, accept orders, upload listing photos, or accept delivery jobs.

Successful UPI webhooks create seller payout rows visible to the relevant seller and finance administrators. The finance screen shows the snapshotted seller UPI ID and phone. An administrator must transfer the recorded net amount outside the app, then record the bank reference in the finance screen. Reconciliation cases are visible only to the buyer and finance administrators; the administrator must complete a real refund before recording its reference:

The console writes an audit entry for account decisions, seller transfers, and completed payment refunds. It does not move money, verify identity or UPI ownership automatically, issue refunds, or settle COD/agent earnings. Never mark an external transfer or refund complete before it has actually cleared.

## Build and install an Android APK

For Google Play preparation, read the repository [PLAY_STORE_CHECKLIST.md](../PLAY_STORE_CHECKLIST.md). The store artifact must be a signed production Android App Bundle, not a debug APK:

```powershell
npm run build:android:production
```

Configure the production Supabase URL and publishable key through EAS environment variables. Do not put payment secrets or service-role credentials in the app bundle.

The project includes an Expo-generated `android` directory. With Android SDK tools and a supported JDK installed, build a local release APK from this directory:

```powershell
.\android\gradlew.bat -p .\android --no-daemon assembleRelease
```

If Java is not on PATH, Android Studio's bundled JDK can be used for the current PowerShell session:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\android\gradlew.bat -p .\android --no-daemon assembleDebug
```

The APK is written to `android\app\build\outputs\apk\release\app-release.apk`. If no Supabase values were embedded at build time, the app opens the first-run backend setup screen; enter the project URL and publishable key after installing it. If `.env.local` exists, Expo embeds those public client values into the app bundle.

On Windows, native CMake can exceed path-length limits when the project is in a deeply nested directory. If the release build fails while creating generated C++ paths, move the checkout to a shorter path or use the documented EAS build profile.

If a short checkout still fails in `:app:buildCMakeDebug` with a `safeareacontext_autolinked_build` path error, use an EAS Android build or enable Windows long paths and rebuild after removing the generated `android\app\.cxx` directory. This is a React Native/CMake Windows build limitation, not an OpenFreeMap configuration error.

Install the APK by transferring it to the Android phone, allowing installation from that file source when prompted, then opening Minuto. ADB can also install it with `adb install -r android\app\build\outputs\apk\release\app-release.apk` when a device with USB debugging is connected.

## Current behavior and limits

- Email/password accounts use Supabase Auth. Users select buyer, local vendor, or delivery agent at setup; the auth session persists on the device.
- Approved vendors publish product photos and inventory. The app adds ₹5 per item to the listed buyer price. Checkout currently adds a ₹6 buyer delivery contribution once; each vendor delivery job also records a ₹6 vendor contribution.
- Buyers can place COD orders or start UPI checkout through a separately hosted YouPI PG instance. Pending payments can be resumed, retried after a terminal failure/expiry, or reconciled against YouPI's server-side status API. UPI orders remain pending until the signed webhook or authenticated server-side gateway status confirms the exact amount; a browser return is not proof of payment. Late/duplicate successful attempts are flagged for manual review.
- Approved vendors mark orders ready; approved agents see the live offer while the app is open. Only the first agent to accept gets the job. Background push notifications and road-distance calculation / per-kilometer agent payouts are not configured.
- An accepted agent can open the vendor pickup, then the buyer's Nagpur delivery address, in Maps.
- Delivery jobs can store real route coordinates when a trusted geocoding or address-capture workflow supplies them. Until then, the map keeps the Nagpur fallback while Google Maps can navigate the text address.
- Approved agents are asked for foreground location permission while signed in. During active app use, Minuto sends a throttled location update every 30 seconds or after roughly 50 metres; buyers and sellers can see the latest point only for accepted or picked-up jobs.
- Seller UPI ID and phone are required before review; account approval is manual and is not automated identity or UPI ownership verification. Buyer UPI funds go to Minuto's gateway account. The finance console tracks manual transfers and refunds but does not execute them. COD collection and agent payouts are not connected, and no in-app buyer support channel is connected. Do not use this as a live-commerce service until real seller verification, support, refunds, COD collection, agent settlement, applicable legal/privacy review, and staging payment tests are complete.

The database schema has not been applied to any project from this repository. The APK can be built without a configured backend, but shared accounts, product uploads, checkout, and delivery jobs work only after a Supabase project is configured and the base schema and all four migrations have been run successfully. UPI also needs deployed Edge Functions and a configured YouPI webhook.
