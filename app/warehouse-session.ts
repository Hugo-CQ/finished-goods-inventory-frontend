export type HouseholdSession = { access_token: string; refresh_token?: string; expires_at: number };
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Configuration = {
  url: string;
  key: string;
  storage: () => SessionStorage;
  fetch?: typeof fetch;
  now?: () => number;
};

export class AuthenticationRequired extends Error {
  constructor() { super("登录已失效，请重新输入访问密码。未保存的草稿已保留。"); }
}

/** One renewal per session, including concurrent photo, polling and save requests. */
export class WarehouseSession {
  private config: Configuration;
  private current: HouseholdSession | null = null;
  private renewal: Promise<string> | null = null;
  private generation = 0;
  private listeners = new Set<(token: string | null) => void>();
  static storageKey = "home-inventory-session-v2";

  constructor(config: Configuration) { this.config = config; }

  subscribe(listener: (token: string | null) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private get now() { return (this.config.now?.() ?? Date.now()) / 1000; }
  private get fetcher() { return this.config.fetch ?? fetch; }

  private save(session: HouseholdSession) {
    if (!session.access_token || !Number.isFinite(session.expires_at)) throw new Error("登录返回不完整，请重试。");
    this.current = session;
    this.config.storage().setItem(WarehouseSession.storageKey, JSON.stringify(session));
    this.listeners.forEach((listener) => listener(session.access_token));
  }

  lock() {
    this.generation++;
    this.current = null;
    this.config.storage().removeItem(WarehouseSession.storageKey);
    this.config.storage().removeItem("home-inventory-access-token");
    this.listeners.forEach((listener) => listener(null));
  }

  async restore(): Promise<string | null> {
    const value = this.config.storage().getItem(WarehouseSession.storageKey);
    if (!value) return null;
    try { this.current = JSON.parse(value) as HouseholdSession; }
    catch { this.lock(); return null; }
    if (!this.current?.access_token || !Number.isFinite(this.current.expires_at)) { this.lock(); return null; }
    return this.accessToken();
  }

  async signIn(email: string, password: string) {
    const generation = ++this.generation;
    const response = await this.fetcher(`${this.config.url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: this.config.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(response.status >= 500 ? "云端暂时不可用，请稍后重试。" : "访问密码不正确，请重试。");
    const result = await response.json();
    if (generation !== this.generation) throw new AuthenticationRequired();
    this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at ?? this.now + (result.expires_in ?? 3600) });
    return result.access_token as string;
  }

  async accessToken(force = false): Promise<string> {
    if (!this.current) throw new AuthenticationRequired();
    if (!force && this.current.expires_at - this.now > 60) return this.current.access_token;
    if (this.renewal) return this.renewal;
    const generation = this.generation;
    const refreshToken = this.current.refresh_token;
    if (!refreshToken) { this.lock(); throw new AuthenticationRequired(); }
    const renewal = (async () => {
      const response = await this.fetcher(`${this.config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: { apikey: this.config.key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }), signal: AbortSignal.timeout(20_000),
      });
      if (generation !== this.generation) throw new AuthenticationRequired();
      if (!response.ok) {
        if (response.status === 400 || response.status === 401) { this.lock(); throw new AuthenticationRequired(); }
        throw new Error("暂时无法续期连接，草稿已保留，请稍后重试。");
      }
      const result = await response.json();
      if (generation !== this.generation) throw new AuthenticationRequired();
      this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at ?? this.now + (result.expires_in ?? 3600) });
      return result.access_token as string;
    })();
    this.renewal = renewal;
    try { return await renewal; } finally { if (this.renewal === renewal) this.renewal = null; }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid API path");
    const generation = this.generation;
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("apikey", this.config.key);
      headers.set("Authorization", `Bearer ${token}`);
      return this.fetcher(`${this.config.url}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(25_000) });
    };
    const token = await this.accessToken();
    let response = await send(token);
    if (generation !== this.generation) throw new AuthenticationRequired();
    if (response.status === 401) {
      // Another request may already have renewed this token while ours was in flight.
      const latest = this.current?.access_token;
      response = await send(latest && latest !== token ? latest : await this.accessToken(true));
      if (generation !== this.generation) throw new AuthenticationRequired();
      if (response.status === 401) { this.lock(); throw new AuthenticationRequired(); }
    }
    return response;
  }
}
