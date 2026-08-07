// shared/supabase-client.js
// Vanilla JS wrapper around Supabase's REST (PostgREST) + Auth APIs.
// No external SDK/CDN dependency — direct fetch() calls, matching the
// pattern already used on the JWings tracking site.

const SUPABASE_URL = "https://jalswkctkuidzucocrmh.supabase.co"; // jwings-marketplace project
const SUPABASE_ANON_KEY = "PASTE-YOUR-ANON-KEY-HERE"; // TODO: get from Supabase → Settings → API

const baseHeaders = {
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

// Swap in the logged-in user's access token once auth is wired up.
function authHeaders(accessToken) {
  return {
    ...baseHeaders,
    "Authorization": `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  };
}

// ---- Generic REST helpers -------------------------------------------------

async function dbSelect(table, query = "", accessToken = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Select failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbInsert(table, payload, accessToken = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Prefer": "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Insert failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbUpdate(table, query, payload, accessToken = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...authHeaders(accessToken), "Prefer": "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbDelete(table, query, accessToken = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Delete failed on ${table}: ${res.status}`);
  return true;
}

// ---- Auth helpers -----------------------------------------------------

async function signUp(email, password, extra = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ email, password, data: extra }),
  });
  if (!res.ok) throw new Error(`Sign up failed: ${res.status}`);
  return res.json();
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status}`);
  return res.json(); // contains access_token, refresh_token, user
}

async function signOut(accessToken) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
}

// ---- Exports ------------------------------------------------------------

window.JWingsDB = {
  select: dbSelect,
  insert: dbInsert,
  update: dbUpdate,
  remove: dbDelete,
  signUp,
  signIn,
  signOut,
};
