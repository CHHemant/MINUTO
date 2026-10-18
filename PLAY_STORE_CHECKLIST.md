# Google Play release checklist

This checklist is required before uploading Minuto to Google Play. A successful local build alone does not mean the app is ready for publication.

## Developer and build setup

- [ ] Create or confirm the Google Play Console developer account.
- [ ] Create or confirm the Expo/EAS project.
- [ ] Run `npx eas-cli@latest login`.
- [ ] Run `npx eas-cli@latest build:configure` if the EAS project has not been linked.
- [ ] Confirm the Android application ID is `com.minuto.shop`.
- [ ] Configure Android signing credentials through EAS or a controlled local keystore.
- [ ] Configure production `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` as EAS environment variables.
- [ ] Confirm no service-role, YouPI merchant secret, webhook secret, or test credential is bundled.
- [ ] Build the store artifact with `npm run build:android:production`.
- [ ] Download and install the resulting `.aab` through an internal Play test track.

## Backend and payments

- [ ] Use a production Supabase project separate from staging.
- [ ] Apply and verify all schema migrations.
- [ ] Replace placeholder finance-admin setup with a controlled operator process.
- [ ] Deploy and smoke-test all payment Edge Functions.
- [ ] Complete YouPI sandbox tests before enabling live credentials.
- [ ] Verify duplicate, delayed, mismatched, failed, expired, cancelled, and retry payment cases.
- [ ] Verify seller identity and payout ownership.
- [ ] Define COD collection, agent settlement, refunds, and disputes.
- [ ] Configure backups, monitoring, incident response, and audit review.

## Play Console declarations

- [ ] Publish a real privacy-policy URL.
- [ ] Publish a real support URL and monitored support email.
- [ ] Complete the Data safety form.
- [ ] Complete the content rating questionnaire.
- [ ] Complete target-audience and age declarations.
- [ ] Declare the photo-library permission and explain seller product-image use.
- [ ] Add an accurate store listing, screenshots, icon, feature graphic, and contact details.
- [ ] Review Google Play payments, user-generated content, marketplace, financial-services, and consumer-protection policies.
- [ ] Test the release on supported Android versions and screen sizes.
- [ ] Submit first to an internal or closed testing track, not production.

## Release commands

From `mobile`:

```powershell
npm ci
npm run typecheck
npm run lint
npx expo-doctor
npm run build:android:production
```

Do not upload a debug APK. Google Play distribution should use the signed production Android App Bundle (`.aab`).
