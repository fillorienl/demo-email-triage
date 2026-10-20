/** Cloudflare Turnstile, loaded only when a bot check is actually needed. */
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; appearance?: string; size?: string }) => string;
      remove: (id: string) => void;
    };
  }
}

let loading: Promise<void> | null = null;
function loadScript() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the bot check"));
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (t: string) => void; onError?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, "error-callback": onError, appearance: "interaction-only" });
      })
      .catch(() => onError?.());
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);
  return <div ref={ref} />;
}
