# JWings Logistics Marketplace

Logistics + marketplace platform. Vendors register and list products; JWings
handles delivery logistics on every sale, plus standalone parcel bookings.

## Stack
- Vanilla JS (no framework, no build step) — matches the existing JWings
  tracking site
- Supabase (Postgres + Auth + Storage) via direct REST calls
- Vercel for hosting/deploys (connected to this repo)

## Folder structure

```
/customer     — public site + customer dashboard (marketplace, cart, track order, book delivery)
/vendor       — vendor dashboard (orders, products, analytics, wallet)
/rider        — rider dashboard (deliveries, earnings)
/admin        — admin dashboard (orders, riders, customers, payments)
/shared       — shared JS (supabase-client.js, currency/FX helpers, UI utils)
/assets       — logo and shared images
/supabase     — schema.sql and any migration files
```

## Setup

1. Create a new Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Copy your project URL + anon key into `shared/supabase-client.js`
   (replace the `SUPABASE_URL` / `SUPABASE_ANON_KEY` placeholders).
4. Push to GitHub, connect the repo to Vercel (see below).
5. No build command needed — publish directory is repo root (or `/public`
   if we restructure later).

## Currency model

- Vendors list products in their own region's currency (`vendors.currency`,
  `products.currency`).
- Buyers see prices converted to their currency at checkout using a live FX
  API. The rate used is snapshotted on the order (`orders.fx_rate_to_buyer`)
  so historical orders don't change value if rates move later.

## Roles

Every user has a `role` in `profiles`: `customer`, `vendor`, `rider`, `admin`.
Role decides which app/dashboard they're routed to after login.

## Status

🚧 Early scaffolding stage. See commit history for progress.
