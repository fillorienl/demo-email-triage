import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

/** Cloudflare Turnstile. Without a secret it only passes in local dev (DEV_ADMIN=1). */
export async function verifyTurnstile(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return env.DEV_ADMIN === "1";
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const json = (await res.json()) as { success: boolean };
  return json.success === true;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * /admin sits behind Cloudflare Access. Access adds a signed JWT; we verify it here too,
 * so the admin API stays closed even if a request reaches the Worker another way.
 */
export async function isAdmin(env: Env, req: Request): Promise<boolean> {
  if (env.DEV_ADMIN === "1") return true;
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  try {
    await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    return true;
  } catch {
    return false;
  }
}
