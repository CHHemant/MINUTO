# Minuto Android app

Minuto is an Expo / React Native marketplace for independent vendors in Nagpur. It supports buyer, vendor, and delivery-agent roles. Supabase provides shared accounts, catalog, image storage, orders, and live delivery-job updates. Authentication sessions are persisted on each phone.

## Set up the shared backend

1. Create a Supabase project.
2. Open its **SQL Editor** and run `supabase/schema.sql` once. This creates the app schema, security policies, order and delivery functions, product-image bucket, and Realtime tables.
3. Run `supabase/migrations/20261018_vendor_payment_details.sql` after the base schema. Sellers must save their UPI ID and phone before their listings can be seen by buyers or included in orders.
4. To enable YouPI UPI checkout, run `supabase/migrations/20261018_youpi_upi_payments.sql`. This adds payment state, order reservation handling, and the protected webhook RPCs.
5. Run `supabase/migrations/20261018_youpi_upi_reliability.sql`. It tracks individual gateway attempts, supports safe retries and payment-status reconciliation, creates private seller payout records, and records payments requiring manual review.
6. Run `supabase/migrations/20261018_marketplace_admin_approval.sql` last. It gates vendor and delivery-agent access behind approval, creates the finance admin allowlist for `hemantchoudhary0@gmail.com`, and adds audited in-app review and manual settlement controls. Existing vendor and agent accounts will require review again.
7. Ensure the allowlisted administrator has a Supabase Auth account with that confirmed email address. Finance access is determined server-side; a client-selected role cannot grant it.
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

The project includes an Expo-generated `android` directory. With Android SDK tools and a supported JDK installed, build a local release APK from this directory:

```powershell
.\android\gradlew.bat -p .\android --no-daemon assembleRelease
```

The APK is written to `android\app\build\outputs\apk\release\app-release.apk`. If no Supabase values were embedded at build time, the app opens the first-run backend setup screen; enter the project URL and publishable key after installing it. If `.env.local` exists, Expo embeds those public client values into the app bundle.

On Windows, native CMake can exceed path-length limits when the project is in a deeply nested directory. If the release build fails while creating generated C++ paths, move the checkout to a shorter path or use the documented EAS build profile.

Install the APK by transferring it to the Android phone, allowing installation from that file source when prompted, then opening Minuto. ADB can also install it with `adb install -r android\app\build\outputs\apk\release\app-release.apk` when a device with USB debugging is connected.

## Current behavior and limits

- Email/password accounts use Supabase Auth. Users select buyer, local vendor, or delivery agent at setup; the auth session persists on the device.
- Approved vendors publish product photos and inventory. The app adds ₹5 per item to the listed buyer price. Checkout currently adds a ₹6 buyer delivery contribution once; each vendor delivery job also records a ₹6 vendor contribution.
- Buyers can place COD orders or start UPI checkout through a separately hosted YouPI PG instance. Pending payments can be resumed, retried after a terminal failure/expiry, or reconciled against YouPI's server-side status API. UPI orders remain pending until the signed webhook or authenticated server-side gateway status confirms the exact amount; a browser return is not proof of payment. Late/duplicate successful attempts are flagged for manual review.
- Approved vendors mark orders ready; approved agents see the live offer while the app is open. Only the first agent to accept gets the job. Background push notifications and road-distance calculation / per-kilometer agent payouts are not configured.
- An accepted agent can open the vendor pickup, then the buyer's Nagpur delivery address, in Maps.
- Seller UPI ID and phone are required before review; account approval is manual and is not automated identity or UPI ownership verification. Buyer UPI funds go to Minuto's gateway account. The finance console tracks manual transfers and refunds but does not execute them. COD collection and agent payouts are not connected, and no in-app buyer support channel is connected. Do not use this as a live-commerce service until real seller verification, support, refunds, COD collection, agent settlement, applicable legal/privacy review, and staging payment tests are complete.

The database schema has not been applied to any project from this repository. The APK can be built without a configured backend, but shared accounts, product uploads, checkout, and delivery jobs work only after a Supabase project is configured and the base schema and all four migrations have been run successfully. UPI also needs deployed Edge Functions and a configured YouPI webhook.
