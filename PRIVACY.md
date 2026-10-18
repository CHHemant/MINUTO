# Minuto Privacy Notice

**Last updated: October 18, 2026**

Minuto is a local marketplace application for buyers, independent vendors, delivery agents, and finance operators. This notice describes the information the application uses while the service is configured for testing and eventual production.

## Information used

Depending on the role and features used, Minuto may process:

- Account email address and authentication identifiers.
- Display name, phone number, and delivery address.
- Vendor pickup address, seller UPI ID, and seller phone number for manual payout operations.
- Product details, inventory, product images, orders, delivery jobs, payment references, UTRs, and payout references.
- Technical authentication and security records maintained by Supabase.

Minuto does not place a service-role key, YouPI webhook secret, or other server secret in the mobile application.

## How information is used

Information is used to:

- Authenticate accounts and enforce buyer, vendor, agent, and finance permissions.
- Display products and manage inventory.
- Create and fulfil orders and delivery jobs.
- Verify UPI payments through the configured payment provider.
- Record manual seller payouts, refunds, reconciliation cases, and audit actions.
- Protect the service from unauthorized access and payment mismatches.

## Service providers

The configured deployment may use Supabase for authentication, database, storage, and server functions, and YouPI for hosted UPI checkout and payment verification. Their current privacy terms and commercial agreements must be reviewed before production launch.

## Sharing

Information is shared only with the service providers and operators required to fulfil an order, deliver a product, verify a payment, or complete a documented finance operation. Seller payout details are not shown to buyers.

## Retention and deletion

Retention periods, account deletion, order-record retention, and financial-record retention must be configured by the marketplace operator in accordance with applicable law and business requirements. To request account assistance or deletion, contact the operator using the published support address.

## Security

Minuto uses authenticated Supabase access, row-level security, protected server functions, signed payment webhooks, exact payment matching, and audit records. No online system is risk-free; suspected account or payment issues should be reported promptly.

## Contact

Before publishing the app, replace this placeholder with a monitored support address and publish this notice at a stable HTTPS URL:

```text
support@example.com
https://example.com/minuto/privacy
```

This repository document is not a substitute for jurisdiction-specific legal advice or the privacy disclosures required by Google Play.
