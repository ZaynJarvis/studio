import { useState, useEffect } from 'react';
import { Icon } from './components';

const TOKEN_KEY = "vgs.accessToken";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { console.warn("auth save failed", e); }
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { console.warn("auth clear failed", e); }
}

export function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function readTokenFromLocation() {
  if (typeof window === "undefined") return "";

  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get("access_token") || url.searchParams.get("token") || "";
  let hashToken = "";
  let nextHash = url.hash;

  if (url.hash.includes("?")) {
    const [hashPath, hashQuery = ""] = url.hash.split("?");
    const params = new URLSearchParams(hashQuery);
    hashToken = params.get("access_token") || params.get("token") || "";
    params.delete("access_token");
    params.delete("token");
    const query = params.toString();
    nextHash = query ? `${hashPath}?${query}` : hashPath;
  }

  const token = (urlToken || hashToken).trim();
  if (!token) return "";

  url.searchParams.delete("access_token");
  url.searchParams.delete("token");
  url.hash = nextHash;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return token;
}

async function verifyToken(token) {
  const res = await fetch("/api/auth/verify", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.ok;
}

async function readAuthConfig() {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error(`auth config failed (${res.status})`);
  return res.json();
}

export function AuthGate({ children }) {
  const [phase, setPhase] = useState("checking");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await readAuthConfig();
        if (cancelled) return;
        if (!cfg.authRequired) {
          setPhase("ready");
          return;
        }
        const urlToken = readTokenFromLocation();
        if (urlToken) setToken(urlToken);
        const existing = urlToken || getToken();
        if (existing && (await verifyToken(existing))) {
          if (!cancelled) setPhase("ready");
          return;
        }
        clearToken();
        if (!cancelled) setPhase("login");
      } catch {
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const token = input.trim();
    if (!token || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (await verifyToken(token)) {
        setToken(token);
        setPhase("ready");
      } else {
        setError("Invalid access token.");
      }
    } catch (err) {
      setError(err.message || "Could not reach server.");
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === "checking") {
    return (
      <div className="auth-screen">
        <div className="auth-loading">
          <span className="spinner" />
          <span>Authenticating&hellip;</span>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="auth-screen">
        <form className="auth-card surface" onSubmit={submit}>
          <div className="auth-eyebrow mono">ACCESS</div>
          <h1 className="display auth-title">Sign in to continue</h1>
          <p className="auth-sub">This deck is gated. Paste your access token to unlock.</p>
          <label className="label" htmlFor="auth-token">Access token</label>
          <input
            id="auth-token"
            className="input mono"
            type="password"
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="paste token"
            autoComplete="off"
            autoFocus
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={submitting || !input.trim()}>
            <Icon name={submitting ? "refresh" : "key"} size={14} className={submitting ? "spin-ic" : undefined} />
            {submitting ? "Verifying" : "Unlock"}
          </button>
          <div className="auth-foot mono">Stored locally in this browser&rsquo;s localStorage</div>
        </form>
      </div>
    );
  }

  return children;
}
