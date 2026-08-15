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
// need to think about token expiry themselves.
//
// refreshPromise dedupes concurrent refreshes: if several requests hit a
// 401 around the same time, they all await the SAME refresh call instead
// of each firing their own — Supabase refresh tokens are single-use, so
// parallel refresh attempts would invalidate each other.

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
      // Refresh failed — fall through, let the original 401 propagate.
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

// Calls a Postgres function exposed via PostgREST (e.g. track_shipment,
// request_vendor_withdrawal). plpgsql `raise exception` messages come
// through as a `message` field in the error body, surfaced here so
// callers can show it directly.
async function dbRpc(fnName, args = {}, accessToken = null) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/rest/v1/rpc/${fnName}`,
      options: { method: "POST", headers: authHeaders(token), body: JSON.stringify(args) },
    }),
    accessToken
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `RPC failed on ${fnName}: ${res.status}`);
  }
  return res.json();
}

// ---- Storage helper ---------------------------------------------------

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

// Uploads to a PRIVATE bucket and returns just the storage path (not a
// public URL, since private buckets require a signed URL to view).
async function uploadPrivateFile(bucket, path, file, accessToken) {
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
  return path;
}

// Generates a temporary signed URL to view a file in a private bucket.
async function getSignedUrl(bucket, path, accessToken, expiresIn = 3600) {
  const res = await requestWithAuthRetry(
    (token) => ({
      url: `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`,
      options: { method: "POST", headers: authHeaders(token), body: JSON.stringify({ expiresIn }) },
    }),
    accessToken
  );
  if (!res.ok) throw new Error(`Couldn't generate a viewable link: ${res.status}`);
  const data = await res.json();
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
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
  return res.json();
}

async function signOut(accessToken) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: authHeaders(accessToken),
  }).catch(() => {});
}

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
  return res.json();
}

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

// Decodes a JWT's payload without verifying it (verification happens
// server-side) — used only to pull the user's own id for profile lookups.
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

async function getMyProfile(accessToken) {
  const claims = accessToken ? decodeJwtPayload(accessToken) : null;
  // Filter explicitly by the token's own user id. Relying on "select=*&limit=1"
  // with no filter is unsafe for admins: since admins can read every profile
  // (via the admin-select policy), an unfiltered query can return an
  // arbitrary row instead of their own — which was causing admins to get
  // redirected to the wrong dashboard after login.
  const query = claims && claims.sub ? `select=*&id=eq.${claims.sub}&limit=1` : "select=*&limit=1";
  const rows = await dbSelect("profiles", query, accessToken);
  return rows[0] || null;
}

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
  rpc: dbRpc,
  uploadFile,
  uploadPrivateFile,
  getSignedUrl,
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
