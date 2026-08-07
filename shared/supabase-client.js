// shared/supabase-client.js
// Vanilla JS wrapper around Supabase's REST (PostgREST) + Auth APIs.
// No external SDK/CDN dependency — direct fetch() calls, matching the
// pattern already used on the JWings tracking site.

const SUPABASE_URL = "https://jalswkctkuidzucocrmh.supabase.co"; // jwings-marketplace project
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphbHN3a2N0a3VpZHp1Y29jcm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDEwNzIsImV4cCI6MjEwMTA3NzA3Mn0.e1Tw7e5oN9B3r0953k0d_5U8kX1hddJhAXRRfVi9C9g"; // TODO: get from Supabase → Settings → API

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

// Confirms the 6-digit code sent to the user's email after signup.
// type is "signup" for new-account confirmation, "email" for email-change, etc.
async function verifyOtp(email, token, type = "signup") {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ email, token, type }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.msg || `Verification failed: ${res.status}`);
  }
  return res.json(); // contains access_token, refresh_token, user
}

// Re-sends the signup confirmation email (with a fresh OTP code).
async function resendOtp(email, type = "signup") {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ email, type }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
  return true;
}

// ---- Session helpers ------------------------------------------------------

function saveSession(session) {
  localStorage.setItem("jwings_session", JSON.stringify(session));
}

function getSession() {
  const raw = localStorage.getItem("jwings_session");
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  localStorage.removeItem("jwings_session");
}

// Fetches the current user's profile row using their access token.
async function getMyProfile(accessToken) {
  const rows = await dbSelect("profiles", "select=*&limit=1", accessToken);
  return rows[0] || null;
}

// Sends the browser to the right dashboard/home page based on role.
function redirectForRole(role) {
  const routes = {
    customer: "/customer/dashboard.html",
    vendor: "/vendor/dashboard.html",
    rider: "/rider/dashboard.html",
    admin: "/admin/dashboard.html",
  };
  window.location.href = routes[role] || "/customer/dashboard.html";
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
  verifyOtp,
  resendOtp,
  saveSession,
  getSession,
  clearSession,
  getMyProfile,
  redirectForRole,
};
