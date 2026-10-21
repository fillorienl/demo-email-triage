/** A tiny pushState router: the app has six screens, no need for a library. */
import { useEffect, useState, type AnchorHTMLAttributes } from "react";

/** The app lives under Vite's `base` (e.g. "/email-triage"); screens use paths without it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function appPath(): string {
  const p = location.pathname;
  return p.startsWith(BASE) ? p.slice(BASE.length) || "/" : p;
}

const listeners = new Set<() => void>();

export function navigate(to: string) {
  if (to === appPath()) return;
  history.pushState(null, "", BASE + to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(appPath);
  useEffect(() => {
    const update = () => setPath(appPath());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={BASE + href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    />
  );
}
