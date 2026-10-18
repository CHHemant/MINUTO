# Minuto

**Local commerce for everyday needs, delivered in minutes.**

Minuto is a neighborhood marketplace for connecting buyers with independent local vendors and delivery agents. The current implementation is designed for Nagpur, Maharashtra, and combines a React Native mobile application, a lightweight web/PWA surface, Supabase backend services, and optional YouPI-hosted UPI checkout.

> **Project status:** The application is in active development. Local type checks, linting, Expo diagnostics, payment-function checks, webhook unit tests, Android JavaScript export, and an Android debug build have passed. A staging Supabase project, YouPI sandbox transaction, and physical-device smoke test are still required before accepting real payments or launching publicly.

## Why the name “Minuto”?

“Minuto” is inspired by the word *minute*. It represents the product promise: simple neighborhood shopping with less waiting, fewer steps, and a focus on quick local fulfillment. The name is short, easy to remember, and works across the buyer, vendor, delivery, and payment experiences.

The name describes the intended experience—not a guarantee that every order will arrive within a fixed number of minutes. Actual delivery time depends on vendor preparation, inventory, distance, traffic, and agent availability.

## What the project includes

### Buyer experience

- Email/password authentication through Supabase Auth.
- Product discovery with search and category information.
- Product images and inventory visibility.
- Favorites.
- Cart and transparent price breakdown.
- Cash on delivery checkout.
- Optional UPI checkout through a hosted YouPI payment page.
- Order and payment status recovery.
- Delivery status visibility and map navigation.

### Vendor experience

- Vendor account onboarding.
- Required UPI ID and phone number before listings can be accepted.
- Manual marketplace approval before vendor features become active.
- Product name, description, category, price, stock, and image publishing.
- Pickup address management.
- Order preparation and handoff to delivery agents.
- Seller payout ledger showing the amount that must be transferred manually.

### Delivery-agent experience

- Delivery-agent onboarding with manual approval.
- Live delivery offers while the application is open.
- Race-safe job acceptance: only the first successful agent receives a job.
- Pickup and delivered status transitions.
- Map navigation to pickup and customer addresses.

### Finance and administration

- Allowlisted finance administrator access.
- Vendor and delivery-agent approval/rejection workflow.
- Review notes and audit history.
- Seller payout records.
- Manual payout transfer reference recording.
- Payment reconciliation cases.
- Manual refund reference recording after an external refund has completed.

The finance console records actions; it does not move money, issue refunds, verify identity automatically, or connect to a bank payout provider.

## Technology stack

| Area | Technology |
| --- | --- |
| Mobile app | Expo SDK 58, React Native 0.88, TypeScript |
| Web surface | Static HTML, manifest, service worker, and shared visual assets |
| Authentication | Supabase Auth |
| Database | PostgreSQL through Supabase |
| Storage | Supabase Storage for product images |
| Realtime | Supabase Realtime for products, orders, delivery jobs, payout changes, and finance updates |
| Server logic | Supabase Edge Functions using Deno |
| Payment gateway | YouPI hosted checkout and signed webhooks |
| Validation | TypeScript, ESLint, Expo Doctor, Deno checks/tests, Gradle Android build |

## Repository layout

```text
.
├── index.html                         # Web/PWA entry point
├── manifest.webmanifest               # Web app metadata
├── sw.js                              # Service worker
├── icons/                             # Web and app icons
└── mobile/
    ├── App.tsx                        # Expo application
    ├── app.json                       # Expo configuration
    ├── package.json                   # Mobile dependencies and scripts
    ├── supabase/
    │   ├── schema.sql                 # Base database schema and RLS
    │   ├── migrations/                # Ordered marketplace/payment migrations
    │   └── functions/                 # YouPI payment Edge Functions
    └── README.md                      # Detailed backend and Android notes
```

## Requirements

For local development:

- Git.
- Node.js compatible with the Expo SDK 58 project.
- npm.
- A Supabase project.
- Expo tooling (`npx expo` can run it without a global install).

For Android development/builds:

- Android SDK and build-tools.
- JDK 17.
- Android Studio or equivalent SDK installation.
- An emulator or Android device for manual testing.

For UPI:

- A separately deployed and configured YouPI instance.
- A YouPI merchant ID.
- A YouPI webhook secret.
- A public HTTPS URL reachable by YouPI webhooks.
- A non-production environment for payment testing.

## Quick start: mobile app

From the repository root:

```powershell
Set-Location .\mobile
npm ci
npx expo start
```

You can then open the project in Expo Go where supported, an Android emulator, or a development build.

### Configure Supabase

Create `mobile\.env.local` from `mobile\.env.example`:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your_key
```

Only use a publishable/anon key in the mobile app. Never place a Supabase service-role key, YouPI webhook secret, or other server secret in `.env.local`, the app bundle, or source control.

If no environment variables are embedded, the application provides a first-run setup screen where a user can enter the Supabase URL and publishable key. The values are saved locally on that device.

## Configure the Supabase backend

Run the SQL files in this exact order in the Supabase SQL Editor:

1. `mobile\supabase\schema.sql`
2. `mobile\supabase\migrations\20261018_vendor_payment_details.sql`
3. `mobile\supabase\migrations\20261018_youpi_upi_payments.sql`
4. `mobile\supabase\migrations\20261018_youpi_upi_reliability.sql`
5. `mobile\supabase\migrations\20261018_marketplace_admin_approval.sql`

The final migration gates vendors and delivery agents behind approval. Existing vendor and agent profiles are moved to pending review when the migration is applied.

### Finance administrator

The approval migration currently allowlists the administrator email configured for this deployment. The account must exist in Supabase Auth and its email must be confirmed. Finance access is checked server-side; selecting a client role cannot grant administrator access.

Before production, replace the deployment-specific allowlist approach with a controlled organization/admin identity process, and review the email against the account that will actually operate the marketplace.

## Configure YouPI UPI checkout

Minuto does not treat a browser redirect as proof of payment. A UPI order becomes paid only after one of these trusted server-side paths verifies the payment:

1. A signed YouPI webhook with a valid HMAC signature.
2. An authenticated server-side status lookup that matches the payment ID, gateway order ID, currency, and exact amount.

Deploy the Edge Functions from `mobile`:

```powershell
Set-Location .\mobile
supabase functions deploy create-youpi-payment --project-ref <project-ref>
supabase functions deploy sync-youpi-payment --project-ref <project-ref>
supabase functions deploy youpi-webhook --no-verify-jwt --project-ref <project-ref>
```

Configure secrets in Supabase. Do not commit their values:

```powershell
supabase secrets set `
  YOUPI_API_URL=https://pay.example.com `
  YOUPI_MERCHANT_ID=<merchant-id> `
  YOUPI_WEBHOOK_SECRET=<webhook-secret> `
  --project-ref <project-ref>
```

Configure the YouPI webhook URL as:

```text
https://<project-ref>.supabase.co/functions/v1/youpi-webhook
```

The YouPI merchant account currently receives buyer funds into Minuto’s configured gateway account. Seller UPI details are collected as payout information, but Minuto does not automatically route buyer funds to sellers.

## Pricing and settlement model

The current pricing rules are:

- ₹5 Minuto markup per item.
- ₹6 buyer delivery contribution per order.
- ₹6 seller delivery contribution per vendor delivery.
- Seller payout ledger amount: seller-price subtotal for that vendor minus the ₹6 seller delivery contribution.

The finance administrator must complete seller transfers outside the application and record the bank/UPI transfer reference only after the transfer clears.

YouPI’s advertised pricing must be independently confirmed. Bank charges, hosting, taxes, commercial terms, refunds, and other operational costs may still apply.

## Android build and installation

### Debug APK

```powershell
Set-Location .\mobile
$env:JAVA_HOME = "C:\Path\To\jdk-17"
.\android\gradlew.bat -p .\android --no-daemon assembleDebug
```

The debug APK is generated at:

```text
mobile\android\app\build\outputs\apk\debug\app-debug.apk
```

### Release APK

```powershell
Set-Location .\mobile
.\android\gradlew.bat -p .\android --no-daemon assembleRelease
```

The release APK is generated at:

```text
mobile\android\app\build\outputs\apk\release\app-release.apk
```

On Windows, native CMake may exceed path-length limits when the repository is stored deeply. If the release build fails while creating generated C++ paths, move the repository to a shorter path or use the EAS build profile.

Install with ADB when a device is connected:

```powershell
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

## Development commands

From `mobile`:

```powershell
npm ci
npm run typecheck
npm run lint
npx expo-doctor
npx --yes deno check `
  supabase/functions/create-youpi-payment/index.ts `
  supabase/functions/sync-youpi-payment/index.ts `
  supabase/functions/youpi-webhook/index.ts
npx --yes deno test supabase/functions/youpi-webhook/webhook_utils_test.ts
npx expo export --platform android --output-dir <temporary-output-directory>
```

## Testing checklist

Before launch, test all of the following in a non-production environment:

### Accounts and permissions

- Buyer registration, email confirmation, sign-in, sign-out, and session restoration.
- Vendor approval, rejection, correction, and re-review.
- Delivery-agent approval and rejection.
- Confirm pending vendors cannot publish, upload images, or receive orders.
- Confirm pending agents cannot view offers or accept jobs.
- Confirm buyers cannot access another buyer’s orders.
- Confirm sellers cannot access another seller’s payout records.
- Confirm non-admin users cannot call finance functions successfully.

### Catalog and orders

- Product validation, image upload, inventory limits, favorites, and stock updates.
- Concurrent checkout for the final available stock.
- Duplicate product IDs in a cart.
- COD order creation and delivery-job creation.
- Multi-vendor order creation.
- Failed order creation and stock rollback.

### UPI

- Successful hosted checkout.
- Failed, expired, and cancelled payment.
- Retry after a terminal payment state.
- Delayed webhook.
- Duplicate webhook.
- Duplicate or late successful payment.
- Amount, currency, order ID, payment ID, and method mismatch.
- Invalid HMAC signature and altered raw body.
- Provider timeout and retry behavior.
- Payment-status recovery when the app is reopened.
- Refund and reconciliation workflow.

### Delivery and settlement

- Vendor marks an order ready.
- Two agents attempt to accept the same job.
- Agent pickup and delivery transitions.
- Invalid status transitions.
- Seller payout snapshot remains unchanged after profile edits.
- Manual payout reference and audit history.

## Security and privacy

- Publishable Supabase keys may be embedded in the client; service-role keys must not be.
- YouPI webhook requests are authenticated with HMAC over the raw request body.
- Payment success requires exact server-side amount and identity matching.
- Payment attempts are stored separately so retries and late events can be reconciled.
- Row Level Security protects profiles, orders, delivery jobs, payout records, and reconciliation cases.
- Seller payout details are not exposed through buyer product data.
- Finance actions require server-side allowlist checks and are recorded in an audit log.
- Seller UPI ownership and identity are not automatically verified by this application.
- Avoid storing unnecessary personal data and obtain the required consent, privacy notices, and retention policies before launch.

## Current limitations and launch blockers

The following are intentionally not represented as complete:

- No automatic seller bank/UPI payout provider.
- No automatic refund provider integration.
- COD collection and cash reconciliation are manual.
- Delivery-agent compensation is not connected to a payout provider.
- Background push notifications are not configured.
- Route distance and per-kilometer agent payout calculation are not configured.
- No in-app buyer support or dispute center.
- Seller identity and UPI ownership verification require an operational process.
- Legal, tax, privacy, consumer-protection, and payment compliance review is required.
- Live staging payment tests have not been completed in this repository environment.

Do not accept live customer payments until these operational, legal, and staging requirements are completed.

## Contributing

1. Create a branch for the change.
2. Keep secrets and generated directories out of Git.
3. Read `mobile\AGENTS.md` before changing Expo or React Native code.
4. Run typecheck, lint, relevant Deno checks/tests, and the smallest relevant build.
5. Describe migration order and rollback considerations for database changes.
6. Do not claim a payment flow is verified without a non-production provider test.

## License

The mobile application license is defined in [`mobile/LICENSE`](mobile/LICENSE). Review third-party package licenses and YouPI’s own deployment and commercial license terms before redistribution or commercial operation.

## Additional documentation

- [Mobile and backend implementation guide](mobile/README.md)
- [Base Supabase schema](mobile/supabase/schema.sql)
- [Supabase migrations](mobile/supabase/migrations)
- [Payment Edge Functions](mobile/supabase/functions)
