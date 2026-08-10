"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const SUPABASE_URL = "https://dkfqdimwcuqlbybyesbq.supabase.co";
const SUPABASE_KEY = "sb_publishable_4sIy9A-kgfK96qH7_hdWdw_6wL5z-Ps";
const HOUSEHOLD_EMAIL = "home-inventory@wuno.cn";
const SESSION_STORAGE_KEY = "home-inventory-access-token";

type StorageRack = {
  rackCode: string;
  name?: string;
  updatedAt?: string;
};

type InventoryBox = {
  boxCode: string;
  displayName?: string;
  containerTypeRaw?: string;
  contentCodeRaw?: string;
  shelfCode?: string;
  roomName?: string;
  cabinetName?: string;
  drawerName?: string;
  slotName?: string;
  rackCode?: string;
  parentBoxCode?: string;
  loadPercent?: number;
  note?: string;
  photoData?: string;
  updatedAt?: string;
};

type InventoryItem = {
  id: string;
  boxCode: string;
  shelfCode?: string;
  materialCode?: string;
  materialName?: string;
  spec?: string;
  quantity?: number;
  unit?: string;
  status?: string;
  category?: string;
  keywords?: string;
  note?: string;
  expiryDate?: string;
  warrantyDate?: string;
  purchaseDate?: string;
  purchasePrice?: string;
  purchaseSource?: string;
  valueLevel?: string;
  estimatedValue?: string;
  valuable?: boolean;
  lowStockThreshold?: number;
  photoData?: string;
  updatedAt?: string;
};

type InventoryState = {
  schemaVersion?: number;
  boxes?: InventoryBox[];
  racks?: StorageRack[];
  binds?: InventoryItem[];
  loans?: Array<{ id: string; itemId: string; returnedAt?: string }>;
};

type SnapshotRow = {
  payload: InventoryState;
  revision: number;
  updated_at: string;
};

type ViewMode = "rack" | "container" | "item";
type SelectedEntity =
  | { type: "rack"; value: StorageRack }
  | { type: "container"; value: InventoryBox }
  | { type: "item"; value: InventoryItem }
  | null;

const containerTypes: Record<string, string> = {
  BX: "收纳箱",
  CT: "纸箱",
  SB: "小收纳盒",
  DR: "抽屉",
  CB: "柜子或柜内格",
  SH: "架子",
  BG: "袋子",
  FL: "文件夹或档案盒",
  TR: "托盘或开放盒",
  PK: "原包装盒",
  CS: "箱包或包袋",
  OT: "其他容器",
};

const contentCategories: Record<string, string> = {
  EL: "电子数码",
  CA: "线材充电",
  TL: "工具五金",
  DC: "证件资料",
  MD: "医药护理",
  FD: "食品囤货",
  CL: "清洁家务",
  PT: "宠物用品",
  KT: "厨房相关",
  OF: "办公文具",
  CO: "衣物配饰",
  BD: "床品家纺",
  TO: "玩具兴趣",
  SE: "季节节日",
  SP: "运动户外",
  BK: "书籍资料",
  VL: "贵重物品",
  MX: "混合杂物",
  OT: "通用或其他",
};

function locationOf(box: InventoryBox) {
  const structured = [box.roomName, box.cabinetName, box.drawerName, box.slotName]
    .filter(Boolean)
    .join(" / ");
  if (structured) return structured;
  if (box.parentBoxCode) return `容器 ${box.parentBoxCode} 内`;
  if (box.rackCode) return `装载架 ${box.rackCode}`;
  return box.shelfCode || "未填写位置";
}

function itemName(item: InventoryItem) {
  return item.materialName?.trim() || item.materialCode?.trim() || "未命名物品";
}

function photoSource(photo?: string) {
  if (!photo) return "";
  return photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`;
}

function formatTime(value?: string) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function matchesQuery(parts: Array<string | number | undefined>, query: string) {
  if (!query.trim()) return true;
  return parts.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export default function Home() {
  const [state, setState] = useState<InventoryState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");
  const [restoringSession, setRestoringSession] = useState(true);
  const [mode, setMode] = useState<ViewMode>("item");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [selected, setSelected] = useState<SelectedEntity>(null);

  const loadWarehouse = useCallback(async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const snapshotResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/home_inventory_snapshots?select=payload,revision,updated_at&limit=1`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );
      if (snapshotResponse.status === 401 || snapshotResponse.status === 403) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        setAccessToken(null);
        setAuthError("验证已过期，请重新输入密码。");
        setState(null);
        return;
      }
      if (!snapshotResponse.ok) throw new Error("无法读取家庭仓库数据");
      const rows = (await snapshotResponse.json()) as SnapshotRow[];
      setState(rows[0]?.payload || { boxes: [], racks: [], binds: [], loans: [] });
      setUpdatedAt(rows[0]?.updated_at);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "家庭云端连接失败");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const restoredToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!restoredToken) {
      setRestoringSession(false);
      return;
    }
    setAccessToken(restoredToken);
    void loadWarehouse(restoredToken).finally(() => setRestoringSession(false));
  }, [loadWarehouse]);

  async function unlockWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || authenticating) return;
    setAuthenticating(true);
    setAuthError("");
    try {
      const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: HOUSEHOLD_EMAIL, password }),
      });
      const auth = (await authResponse.json()) as { access_token?: string };
      if (!authResponse.ok || !auth.access_token) {
        throw new Error("密码不正确，请重试。");
      }
      sessionStorage.setItem(SESSION_STORAGE_KEY, auth.access_token);
      setAccessToken(auth.access_token);
      setPassword("");
      await loadWarehouse(auth.access_token);
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "验证失败，请稍后重试。");
    } finally {
      setAuthenticating(false);
    }
  }

  function lockWarehouse() {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setAccessToken(null);
    setAuthenticating(false);
    setLoading(false);
    setState(null);
    setUpdatedAt(undefined);
    setError("");
    setAuthError("");
  }

  const boxes = state?.boxes || [];
  const racks = state?.racks || [];
  const items = state?.binds || [];
  const activeLoans = (state?.loans || []).filter((loan) => !loan.returnedAt);
  const totalQuantity = items.reduce((sum, item) => sum + Math.max(0, item.quantity || 0), 0);
  const attentionCount = items.filter((item) => {
    const low = item.lowStockThreshold !== undefined && (item.quantity || 0) <= item.lowStockThreshold;
    const expired = item.expiryDate ? new Date(item.expiryDate) < new Date() : false;
    return low || expired || ["待维修", "待丢弃"].includes(item.status || "");
  }).length;

  const itemCategories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category).filter(Boolean) as string[])).sort(),
    [items],
  );
  const itemStatuses = useMemo(
    () => Array.from(new Set(items.map((item) => item.status).filter(Boolean) as string[])).sort(),
    [items],
  );

  const filteredItems = items.filter(
    (item) =>
      (category === "全部" || item.category === category) &&
      (status === "全部" || item.status === status) &&
      matchesQuery(
        [itemName(item), item.materialCode, item.spec, item.category, item.keywords, item.boxCode, item.note],
        query,
      ),
  );
  const filteredBoxes = boxes.filter((box) =>
    matchesQuery(
      [box.displayName, box.boxCode, containerTypes[box.containerTypeRaw || ""], contentCategories[box.contentCodeRaw || ""], locationOf(box), box.note],
      query,
    ),
  );
  const filteredRacks = racks.filter((rack) => matchesQuery([rack.name, rack.rackCode], query));

  const visibleCount = mode === "item" ? filteredItems.length : mode === "container" ? filteredBoxes.length : filteredRacks.length;

  if (restoringSession) {
    return <main className="login-shell"><div className="login-card login-loading"><div className="loader" /><p>正在恢复安全访问…</p></div></main>;
  }

  if (!accessToken) {
    return (
      <main className="login-shell">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-brand"><span className="brand-mark" aria-hidden="true"><i /></span><div><b>航标</b><span>家庭仓库</span></div></div>
          <p className="eyebrow">PRIVATE HOME INVENTORY</p>
          <h1 id="login-title">进入家庭仓库</h1>
          <p className="login-copy">请输入家庭访问密码。账号已固定，无需填写用户名。</p>
          <form onSubmit={unlockWarehouse}>
            <label htmlFor="household-password">访问密码</label>
            <input
              id="household-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="输入访问密码"
              aria-describedby={authError ? "password-error" : undefined}
            />
            {authError && <p className="login-error" id="password-error" role="alert">{authError}</p>}
            <button type="submit" disabled={!password || authenticating}>{authenticating ? "正在验证…" : "验证并进入"}</button>
          </form>
          <small>验证由 Supabase Auth 完成 · 网页端仅供查看</small>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <div><b>航标</b><span>家庭仓库</span></div>
        </div>
        <div className="topbar-meta">
          <span className="read-only">只读模式</span>
          <span className={`cloud-state ${error ? "offline" : ""}`}>
            <i />{loading ? "正在同步" : error ? "连接异常" : "云端已连接"}
          </span>
          <button className="refresh-button" onClick={() => void loadWarehouse(accessToken)} disabled={loading} aria-label="刷新云端数据">
            ↻
          </button>
          <button className="lock-button" onClick={lockWarehouse}>锁定</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">HOME INVENTORY · 家庭空间索引</p>
          <h1>家的每一件东西，<br />都有清晰坐标。</h1>
          <p className="hero-copy">查看装载架、容器和物品，快速回答“东西在哪儿”和“还剩多少”。</p>
        </div>
        <div className="hero-status">
          <span>最后同步</span>
          <strong>{formatTime(updatedAt)}</strong>
          <small>数据由 iPhone 端维护，网页端仅供查看</small>
        </div>
      </section>

      <section className="metrics" aria-label="仓库摘要">
        <article><span className="metric-icon blue">⌂</span><div><b>{racks.length}</b><small>装载架层位</small></div></article>
        <article><span className="metric-icon amber">▣</span><div><b>{boxes.length}</b><small>收纳容器</small></div></article>
        <article><span className="metric-icon green">◇</span><div><b>{items.length}</b><small>物品种类 · {totalQuantity} 件</small></div></article>
        <article><span className="metric-icon coral">!</span><div><b>{attentionCount + activeLoans.length}</b><small>需要留意</small></div></article>
      </section>

      <section className="warehouse-panel">
        <div className="panel-head">
          <div><p className="eyebrow">WAREHOUSE</p><h2>仓库管理</h2></div>
          <label className="search-field">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、编号、位置或备注" />
            {query && <button onClick={() => setQuery("")} aria-label="清除搜索">×</button>}
          </label>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="仓库视图">
          {([
            ["rack", "装载架", racks.length],
            ["container", "容器", boxes.length],
            ["item", "物品", items.length],
          ] as const).map(([value, label, count]) => (
            <button key={value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setSelected(null); }} role="tab" aria-selected={mode === value}>
              {label}<span>{count}</span>
            </button>
          ))}
        </div>

        {mode === "item" && (
          <div className="filters">
            <label>分类<select value={category} onChange={(event) => setCategory(event.target.value)}><option>全部</option>{itemCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option>全部</option>{itemStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
            <span>显示 {visibleCount} 条结果</span>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="loader" /><h3>正在读取家庭仓库</h3><p>连接固定账号并同步最新快照。</p></div>
        ) : error ? (
          <div className="empty-state error-state"><span>!</span><h3>{error}</h3><p>请检查网络后重新加载。</p><button onClick={() => void loadWarehouse(accessToken)}>重新加载</button></div>
        ) : visibleCount === 0 ? (
          <div className="empty-state"><span>⌂</span><h3>{state && items.length + boxes.length + racks.length === 0 ? "云端仓库还是空的" : "没有匹配结果"}</h3><p>{state && items.length + boxes.length + racks.length === 0 ? "请先在 iPhone APP 的设置中上传本机数据。" : "换一个关键词或清除筛选后再试。"}</p></div>
        ) : (
          <div className="content-grid">
            <div className="entity-list">
              {mode === "item" && filteredItems.map((item) => {
                const box = boxes.find((value) => value.boxCode === item.boxCode);
                const low = item.lowStockThreshold !== undefined && (item.quantity || 0) <= item.lowStockThreshold;
                return <button className="entity-row" key={item.id} onClick={() => setSelected({ type: "item", value: item })}>
                  <span className="thumb">{photoSource(item.photoData) ? <img src={photoSource(item.photoData)} alt="" /> : "◇"}</span>
                  <span className="entity-main"><b>{itemName(item)}</b><small>{[item.spec, item.category].filter(Boolean).join(" · ") || "未分类"}</small><em>{box ? `${box.displayName || box.boxCode} · ${locationOf(box)}` : item.shelfCode || "未指定容器"}</em></span>
                  <span className="entity-end"><strong>{item.quantity || 0}<small>{item.unit || "件"}</small></strong><i className={low ? "warn" : ""}>{low ? "库存偏低" : item.status || "备用"}</i></span>
                </button>;
              })}
              {mode === "container" && filteredBoxes.map((box) => {
                const count = items.filter((item) => item.boxCode === box.boxCode).length;
                return <button className="entity-row" key={box.boxCode} onClick={() => setSelected({ type: "container", value: box })}>
                  <span className="thumb box">▣</span><span className="entity-main"><b>{box.displayName || containerTypes[box.containerTypeRaw || ""] || "未命名容器"}</b><small>{box.boxCode} · {contentCategories[box.contentCodeRaw || ""] || "未分类"}</small><em>{locationOf(box)}</em></span><span className="entity-end"><strong>{count}<small>种</small></strong><i>{box.loadPercent || 0}% 装载</i></span>
                </button>;
              })}
              {mode === "rack" && filteredRacks.map((rack) => {
                const rackBoxes = boxes.filter((box) => box.rackCode === rack.rackCode).length;
                return <button className="entity-row" key={rack.rackCode} onClick={() => setSelected({ type: "rack", value: rack })}>
                  <span className="thumb rack">▤</span><span className="entity-main"><b>{rack.name || `装载架 ${rack.rackCode}`}</b><small>{rack.rackCode}</small><em>{rackBoxes ? `${rackBoxes} 个容器位于此处` : "当前没有绑定容器"}</em></span><span className="entity-end"><strong>{rackBoxes}<small>箱</small></strong><i>已归档</i></span>
                </button>;
              })}
            </div>
            <aside className="detail-panel">
              {selected ? <EntityDetail selected={selected} boxes={boxes} items={items} /> : <div className="detail-placeholder"><span>⌖</span><b>选择一条记录</b><p>这里会显示完整位置、数量与备注。</p></div>}
            </aside>
          </div>
        )}
      </section>

      <footer><span>航标家庭仓库</span><span>查看模式 · 无录入入口</span></footer>
    </main>
  );
}

function EntityDetail({ selected, boxes, items }: { selected: Exclude<SelectedEntity, null>; boxes: InventoryBox[]; items: InventoryItem[] }) {
  if (selected.type === "item") {
    const item = selected.value;
    const box = boxes.find((value) => value.boxCode === item.boxCode);
    return <div className="detail-content"><p className="eyebrow">ITEM DETAIL</p><h3>{itemName(item)}</h3>{photoSource(item.photoData) && <img className="detail-photo" src={photoSource(item.photoData)} alt={itemName(item)} />}<dl><div><dt>数量</dt><dd>{item.quantity || 0} {item.unit || "件"}</dd></div><div><dt>状态</dt><dd>{item.status || "备用"}</dd></div><div><dt>分类</dt><dd>{item.category || "未分类"}</dd></div><div><dt>容器</dt><dd>{box?.displayName || item.boxCode || "未指定"}</dd></div><div><dt>位置</dt><dd>{box ? locationOf(box) : item.shelfCode || "未填写"}</dd></div>{item.expiryDate && <div><dt>到期日</dt><dd>{item.expiryDate}</dd></div>}</dl>{item.note && <p className="note">{item.note}</p>}</div>;
  }
  if (selected.type === "container") {
    const box = selected.value;
    const contained = items.filter((item) => item.boxCode === box.boxCode);
    return <div className="detail-content"><p className="eyebrow">CONTAINER DETAIL</p><h3>{box.displayName || containerTypes[box.containerTypeRaw || ""] || "未命名容器"}</h3><span className="detail-code">{box.boxCode}</span><dl><div><dt>类型</dt><dd>{containerTypes[box.containerTypeRaw || ""] || "其他容器"}</dd></div><div><dt>内容</dt><dd>{contentCategories[box.contentCodeRaw || ""] || "未分类"}</dd></div><div><dt>位置</dt><dd>{locationOf(box)}</dd></div><div><dt>装载率</dt><dd>{box.loadPercent || 0}%</dd></div><div><dt>物品</dt><dd>{contained.length} 种</dd></div></dl>{contained.length > 0 && <ul className="mini-list">{contained.slice(0, 5).map((item) => <li key={item.id}><span>{itemName(item)}</span><b>{item.quantity || 0} {item.unit || "件"}</b></li>)}</ul>}{box.note && <p className="note">{box.note}</p>}</div>;
  }
  const rack = selected.value;
  const rackBoxes = boxes.filter((box) => box.rackCode === rack.rackCode);
  return <div className="detail-content"><p className="eyebrow">RACK DETAIL</p><h3>{rack.name || `装载架 ${rack.rackCode}`}</h3><span className="detail-code">{rack.rackCode}</span><dl><div><dt>绑定容器</dt><dd>{rackBoxes.length} 个</dd></div><div><dt>最近更新</dt><dd>{formatTime(rack.updatedAt)}</dd></div></dl>{rackBoxes.length > 0 && <ul className="mini-list">{rackBoxes.map((box) => <li key={box.boxCode}><span>{box.displayName || box.boxCode}</span><b>{box.loadPercent || 0}%</b></li>)}</ul>}</div>;
}
