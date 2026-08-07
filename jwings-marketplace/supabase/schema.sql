-- =========================================================
-- JWings Logistics Marketplace — Supabase Schema
-- =========================================================
-- Run this in the Supabase SQL Editor on a FRESH project.
-- Order matters (dependencies), so run top to bottom.
-- =========================================================

-- ---------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- 1. PROFILES (extends Supabase auth.users)
-- One row per authenticated user, role decides which
-- dashboard/app they land on.
-- ---------------------------------------------------------
create type user_role as enum ('customer', 'vendor', 'rider', 'admin');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  full_name text not null,
  email text unique not null,
  phone text,
  avatar_url text,
  date_of_birth date,
  gender text,
  -- region drives default currency (NGN vendor/customer vs USD, etc.)
  country text default 'Nigeria',
  currency text not null default 'NGN', -- ISO 4217 code, e.g. NGN, USD
  two_factor_enabled boolean default false,
  email_notifications boolean default true,
  sms_notifications boolean default true,
  marketing_emails boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------
-- 2. ADDRESSES (customer delivery addresses, vendor pickup)
-- ---------------------------------------------------------
create table addresses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  label text default 'Home', -- Home, Office, etc.
  full_address text not null,
  city text,
  state text,
  country text default 'Nigeria',
  latitude numeric,
  longitude numeric,
  is_default boolean default false,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------
-- 3. VENDORS
-- ---------------------------------------------------------
create table vendors (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  store_name text not null,
  store_slug text unique not null,
  store_logo_url text,
  description text,
  city text,
  state text,
  country text default 'Nigeria',
  currency text not null default 'NGN', -- vendor's native listing currency
  is_verified boolean default false,
  status text default 'pending' check (status in ('pending','active','suspended')),
  commission_rate numeric(5,2) not null default 10.00, -- percent, configurable per vendor
  wallet_balance numeric(14,2) not null default 0,
  average_rating numeric(3,2) default 0,
  total_reviews integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_vendors_profile on vendors(profile_id);

-- ---------------------------------------------------------
-- 4. RIDERS
-- ---------------------------------------------------------
create table riders (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  rider_code text unique not null, -- e.g. JW-1024
  vehicle_type text, -- motorcycle, bicycle, van
  vehicle_plate text,
  is_online boolean default false,
  status text default 'pending' check (status in ('pending','active','suspended')),
  wallet_balance numeric(14,2) not null default 0,
  documents_verified boolean default false,
  current_lat numeric,
  current_lng numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_riders_profile on riders(profile_id);

-- ---------------------------------------------------------
-- 5. CATEGORIES
-- ---------------------------------------------------------
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  icon text,
  parent_id uuid references categories(id),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------
-- 6. PRODUCTS
-- ---------------------------------------------------------
create table products (
  id uuid primary key default uuid_generate_v4(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  category_id uuid references categories(id),
  name text not null,
  description text,
  price numeric(14,2) not null,        -- in vendor's currency
  currency text not null default 'NGN', -- copied from vendor at creation time
  compare_at_price numeric(14,2),       -- for showing % off
  stock integer not null default 0,
  sku text,
  images text[] default '{}',
  status text default 'active' check (status in ('active','inactive','out_of_stock')),
  weight_kg numeric(6,2), -- used for delivery fee calc
  rating numeric(3,2) default 0,
  total_reviews integer default 0,
  total_sold integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_products_vendor on products(vendor_id);
create index idx_products_category on products(category_id);

-- ---------------------------------------------------------
-- 7. ORDERS
-- Currency conversion snapshot lives here so historical
-- orders never change value if FX rates move later.
-- ---------------------------------------------------------
create table orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text unique not null, -- e.g. JW12345
  customer_id uuid not null references profiles(id),
  delivery_address_id uuid references addresses(id),

  buyer_currency text not null,         -- currency the customer paid in
  fx_rate_to_buyer numeric(18,8),       -- snapshot rate at time of order (vendor currency -> buyer currency)

  subtotal numeric(14,2) not null,      -- in buyer_currency
  delivery_fee numeric(14,2) not null default 0,
  service_fee numeric(14,2) not null default 0,
  total numeric(14,2) not null,

  delivery_type text default 'standard' check (delivery_type in ('standard','express','same_day','pickup')),
  order_notes text,

  status text default 'pending' check (
    status in ('pending','new','accepted','preparing','out_for_delivery','completed','cancelled','refunded')
  ),
  payment_status text default 'unpaid' check (payment_status in ('unpaid','paid','refunded','failed')),
  payment_method text, -- card, bank_transfer, wallet, apple_pay etc.

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_orders_customer on orders(customer_id);
create index idx_orders_status on orders(status);

-- ---------------------------------------------------------
-- 8. ORDER ITEMS
-- Each order can contain items from multiple vendors —
-- vendor_id is stored per line item so vendor dashboards
-- can filter "their" orders even in a mixed cart.
-- ---------------------------------------------------------
create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  product_id uuid not null references products(id),
  product_name text not null,     -- snapshot in case product changes later
  quantity integer not null default 1,
  unit_price numeric(14,2) not null,   -- vendor currency, snapshot
  vendor_currency text not null,
  unit_price_buyer_currency numeric(14,2) not null, -- converted, snapshot
  line_total_buyer_currency numeric(14,2) not null,
  variant text, -- e.g. "Black, L"
  vendor_order_status text default 'new' check (
    vendor_order_status in ('new','accepted','preparing','out_for_delivery','completed','cancelled')
  ),
  created_at timestamptz default now()
);

create index idx_order_items_order on order_items(order_id);
create index idx_order_items_vendor on order_items(vendor_id);

-- ---------------------------------------------------------
-- 9. SHIPMENTS (covers both marketplace-order deliveries
-- AND standalone "Book a Delivery" parcel bookings)
-- ---------------------------------------------------------
create table shipments (
  id uuid primary key default uuid_generate_v4(),
  tracking_id text unique not null, -- e.g. JW-240519-001
  order_id uuid references orders(id), -- null if standalone parcel booking
  sender_id uuid references profiles(id), -- for standalone bookings
  rider_id uuid references riders(id),

  pickup_address text not null,
  pickup_lat numeric,
  pickup_lng numeric,
  dropoff_address text not null,
  dropoff_lat numeric,
  dropoff_lng numeric,

  recipient_name text,
  recipient_phone text,

  package_type text,
  package_weight_kg numeric(6,2),
  delivery_type text default 'standard' check (delivery_type in ('standard','express','same_day')),
  special_instructions text,

  delivery_fee numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  payment_status text default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),

  status text default 'order_received' check (
    status in ('order_received','rider_assigned','picked_up','in_transit','arriving_soon','delivered','cancelled')
  ),
  estimated_arrival timestamptz,
  distance_km numeric(6,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_shipments_order on shipments(order_id);
create index idx_shipments_rider on shipments(rider_id);
create index idx_shipments_tracking on shipments(tracking_id);

-- ---------------------------------------------------------
-- 10. SHIPMENT TRACKING EVENTS (timeline shown on Track Order page)
-- ---------------------------------------------------------
create table shipment_events (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  status text not null,
  note text,
  lat numeric,
  lng numeric,
  created_at timestamptz default now()
);

create index idx_shipment_events_shipment on shipment_events(shipment_id);

-- ---------------------------------------------------------
-- 11. WALLET TRANSACTIONS (vendor payouts + rider earnings)
-- ---------------------------------------------------------
create table wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  owner_type text not null check (owner_type in ('vendor','rider')),
  vendor_id uuid references vendors(id),
  rider_id uuid references riders(id),
  type text not null check (type in ('credit','debit','withdrawal','commission','refund')),
  amount numeric(14,2) not null,
  currency text not null default 'NGN',
  related_order_id uuid references orders(id),
  status text default 'completed' check (status in ('pending','completed','failed')),
  description text,
  created_at timestamptz default now()
);

create index idx_wallet_tx_vendor on wallet_transactions(vendor_id);
create index idx_wallet_tx_rider on wallet_transactions(rider_id);

-- ---------------------------------------------------------
-- 12. REVIEWS
-- ---------------------------------------------------------
create table reviews (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id),
  customer_id uuid not null references profiles(id),
  vendor_id uuid references vendors(id),
  product_id uuid references products(id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

create index idx_reviews_vendor on reviews(vendor_id);
create index idx_reviews_product on reviews(product_id);

-- ---------------------------------------------------------
-- 13. NOTIFICATIONS
-- ---------------------------------------------------------
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  category text default 'orders' check (category in ('orders','promotions','updates','system')),
  title text not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index idx_notifications_user on notifications(user_id);

-- ---------------------------------------------------------
-- 14. FX RATES CACHE (optional local cache of live FX API results)
-- ---------------------------------------------------------
create table fx_rates (
  id uuid primary key default uuid_generate_v4(),
  base_currency text not null,
  target_currency text not null,
  rate numeric(18,8) not null,
  fetched_at timestamptz default now()
);

create index idx_fx_rates_pair on fx_rates(base_currency, target_currency, fetched_at desc);

-- ---------------------------------------------------------
-- 15. ROW LEVEL SECURITY
-- Baseline policies — tighten further as needed.
-- ---------------------------------------------------------
alter table profiles enable row level security;
alter table addresses enable row level security;
alter table vendors enable row level security;
alter table riders enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table shipments enable row level security;
alter table shipment_events enable row level security;
alter table wallet_transactions enable row level security;
alter table reviews enable row level security;
alter table notifications enable row level security;

-- Profiles: users see/edit their own row
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- Addresses: owner only
create policy "addresses_owner" on addresses for all using (auth.uid() = user_id);

-- Products: public read (active only), vendor manages own
create policy "products_public_read" on products for select using (status = 'active');
create policy "products_vendor_manage" on products for all
  using (vendor_id in (select id from vendors where profile_id = auth.uid()));

-- Vendors: public read basic info, vendor manages own row
create policy "vendors_public_read" on vendors for select using (true);
create policy "vendors_manage_own" on vendors for update using (profile_id = auth.uid());

-- Orders: customer sees own, vendor sees orders containing their items (via order_items join, enforced in app layer/API)
create policy "orders_customer_own" on orders for select using (customer_id = auth.uid());
create policy "orders_customer_insert" on orders for insert with check (customer_id = auth.uid());

-- Order items: visible if you own the parent order OR you're the vendor on that line
create policy "order_items_customer_read" on order_items for select
  using (order_id in (select id from orders where customer_id = auth.uid()));
create policy "order_items_vendor_read" on order_items for select
  using (vendor_id in (select id from vendors where profile_id = auth.uid()));

-- Notifications: owner only
create policy "notifications_owner" on notifications for all using (user_id = auth.uid());

-- NOTE: Admin role should bypass RLS via a service-role key on the
-- admin dashboard backend, NOT the anon key. Never expose the
-- service-role key in client-side code.
