/** App-wide state: config, the visitor's sandbox and inbox, and the Process inbox run. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type AppState, type Config } from "./api";
import { Turnstile } from "./components/Turnstile";

interface Store {
  config: Config | null;
  state: AppState | null;
  busy: Set<string>;
  running: boolean;
  notice: string | null;
  setNotice: (n: string | null) => void;
  refresh: () => Promise<AppState | null>;
  ensureSandbox: () => Promise<boolean>;
  processInbox: () => Promise<void>;
  processOne: (id: string) => Promise<void>;
  /** A fresh Turnstile token for one protected call (compose). */
  takeToken: () => string | null;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

const CONCURRENCY = 3;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const [tsKey, setTsKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      return s;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    api.config().then(setConfig, (e) => setNotice(String(e.message ?? e)));
    refresh();
  }, [refresh]);

  // Live emails arrive server-side; poll while a sandbox exists and the tab is visible.
  useEffect(() => {
    if (!state?.sandbox) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 6000);
    return () => clearInterval(t);
  }, [state?.sandbox, refresh]);

  const takeToken = useCallback(() => {
    const t = token.current;
    token.current = null;
    setTsKey((k) => k + 1); // tokens are single-use: render a fresh widget
    return t;
  }, []);

  const ensureSandbox = useCallback(async () => {
    if (state?.sandbox) return true;
    try {
      await api.start(config?.turnstileSiteKey ? takeToken() : null);
      await refresh();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [state?.sandbox, config?.turnstileSiteKey, takeToken, refresh]);

  const runIds = useCallback(
    async (ids: string[]) => {
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!;
          setBusy((b) => new Set(b).add(id));
          try {
            const r = await api.process(id);
            if (!r.ok && r.error) setNotice(r.error);
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
            if (e instanceof ApiError && e.status === 429) queue.length = 0;
          } finally {
            setBusy((b) => {
              const n = new Set(b);
              n.delete(id);
              return n;
            });
            await refresh();
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    },
    [refresh],
  );

  const processInbox = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setNotice(null);
    try {
      if (!(await ensureSandbox())) return;
      const s = await refresh();
      const ids = (s?.emails ?? []).filter((e) => e.status === "new" || e.status === "error").map((e) => e.id);
      await runIds(ids);
    } finally {
      setRunning(false);
    }
  }, [running, ensureSandbox, refresh, runIds]);

  const processOne = useCallback((id: string) => runIds([id]), [runIds]);

  return (
    <Ctx.Provider value={{ config, state, busy, running, notice, setNotice, refresh, ensureSandbox, processInbox, processOne, takeToken }}>
      {children}
      {config?.turnstileSiteKey && (
        <div className="fixed bottom-4 right-4 z-50">
          <Turnstile key={tsKey} siteKey={config.turnstileSiteKey} onToken={(t) => (token.current = t)} />
        </div>
      )}
    </Ctx.Provider>
  );
}
