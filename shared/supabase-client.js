// shared/supabase-client.js
// Vanilla JS wrapper around Supabase's REST (PostgREST) + Auth APIs.
// No external SDK/CDN dependency — direct fetch() calls, matching the
// pattern already used on the JWings tracking site.

const SUPABASE_URL = "https://jalswkctkuidzucocrmh.supabase.co"; // jwings-marketplace project
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphbHN3a2N0a3VpZHp1Y29jcm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDEwNzIsImV4cCI6MjEwMTA3NzA3Mn0.e1Tw7e5oN9B3r0953k0d_5U8kX1hddJhAXRRfVi9C9g";

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

// ---- Token refresh ---------------------------------------------------
//
// Supabase access tokens expire (~1hr). Every REST helper below routes
// through requestWithAuthRetry(), which transparently refreshes the
// session and retries once if a request comes back 401 — so pages never
// need to think about token expiry themselves, they just keep calling
// window.JWingsDB.select/insert/update/remove as before.
//
// refreshPromise dedupes concurrent refreshes: if several requests hit
// a 401 around the same time (e.g. a page firing off a few queries on
// load), they all await the *same* refresh call instead of each firing
// their own — important because Supabase refresh tokens are single-use,
// so parallel refresh attempts would invalidate each other.

let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const session = getSession();
      if (!session || !session.refresh_token) {
        throw new Error("No session to refresh.");
      }

      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });

      if (!res.ok) {
        // Refresh token itself is invalid/expired too — nothing more we
        // can do client-side. Clear the stale session so the next guarded
        // page load sends the user back to login instead of looping.
        clearSession();
        throw new Error("Your session has expired. Please log in again.");
      }

      const newSession = await res.json();
      saveSession(newSession);
      return newSession;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Runs a fetch, and if it comes back 401 while a session exists, refreshes
// the token once and retries with the new one. buildRequest(token) is
// called fresh on each attempt so the retry actually uses the new token.
async function requestWithAuthRetry(buildRequest, accessToken) {
  let token = accessToken;
  let { url, options } = buildRequest(token);
  let res = await fetch(url, options);

  if (res.status === 401 && getSession()) {
    try {
      const refreshed = await refreshAccessToken();
      token = refreshed.access_token;
      ({ url, options } = buildRequest(token));
      res = await fetch(url, options);
    } catch (err) {
      // Refresh failed — fall through and let the original 401 response
      // propagate as before, so existing error handling still works.
    }
  }
  return res;
}

// ---- Generic REST helpers -------------------------------------------------

async function dbSelect(table, query = "", accessToken = null) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/rest/v1/${table}?${query}`,
      options: { headers: authHeaders(token) },
    }),
    accessToken
  );
  if (!res.ok) throw new Error(`Select failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbInsert(table, payload, accessToken = null) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/rest/v1/${table}`,
      options: {
        method: "POST",
        headers: { ...authHeaders(token), "Prefer": "return=representation" },
        body: JSON.stringify(payload),
      },
    }),
    accessToken
  );
  if (!res.ok) throw new Error(`Insert failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbUpdate(table, query, payload, accessToken = null) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/rest/v1/${table}?${query}`,
      options: {
        method: "PATCH",
        headers: { ...authHeaders(token), "Prefer": "return=representation" },
        body: JSON.stringify(payload),
      },
    }),
    accessToken
  );
  if (!res.ok) throw new Error(`Update failed on ${table}: ${res.status}`);
  return res.json();
}

async function dbDelete(table, query, accessToken = null) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/rest/v1/${table}?${query}`,
      options: { method: "DELETE", headers: authHeaders(token) },
    }),
    accessToken
  );
  if (!res.ok) throw new Error(`Delete failed on ${table}: ${res.status}`);
  return true;
}

// ---- Storage helper ---------------------------------------------------

// Uploads a file to Supabase Storage and returns its public URL.
// bucket: e.g. "product-images". path: a unique file path/name within the bucket.
async function uploadFile(bucket, path, file, accessToken) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
      options: {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      },
    }),
    accessToken
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed: ${res.status}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
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
  // Best-effort — if the token's already expired, the server call may
  // itself 401, but we clear the local session either way below.
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: authHeaders(accessToken),
  }).catch(() => {});
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
  uploadFile,
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
