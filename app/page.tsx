"use client";
/* eslint-disable @next/next/no-img-element -- authenticated Storage photos use short-lived blob URLs */

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

type RackGroup = {
  groupCode: string;
  name: string;
  layers: StorageRack[];
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
  cloudPhotoPath?: string;
  cloudPhotoVersion?: number;
  createdAt?: string;
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
  cloudPhotoPath?: string;
  cloudPhotoVersion?: number;
  createdAt?: string;
  updatedAt?: string;
};

type InventoryState = {
  schemaVersion?: number;
  boxes?: InventoryBox[];
  racks?: StorageRack[];
  binds?: InventoryItem[];
  loans?: Array<{ id: string; itemId: string; returnedAt?: string }>;
  events?: Array<Record<string, unknown>>;
  locations?: Array<Record<string, unknown>>;
  trash?: Array<Record<string, unknown>>;
};

type SnapshotRow = {
  payload: InventoryState;
  revision: number;
  updated_at: string;
};

type CommitResponse = {
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

function compactRackCode(value: string) {
  return value.toLocaleUpperCase().replace(/[^A-Z0-9]/g, "");
}

function rackGroupCode(value: string) {
  const code = compactRackCode(value);
  return code.length === 4 ? code.slice(0, 3) : code || value;
}

function rackLayerNumber(value: string) {
  const code = compactRackCode(value);
  return code.length === 4 ? Number(code.slice(-1)) || 0 : 0;
}

function displayRackCode(value: string) {
  const code = compactRackCode(value);
  return code.length === 4 ? `${code.slice(0, 1)}-${code.slice(1, 3)}-${code.slice(3)}` : value;
}

function baseRackName(rack: StorageRack) {
  const name = rack.name?.trim();
  if (!name) return `装载架 ${rackGroupCode(rack.rackCode)}`;
  const layer = rackLayerNumber(rack.rackCode);
  return layer ? name.replace(new RegExp(`\\s+${layer}层$`), "").trim() : name;
}

function groupRacks(racks: StorageRack[]) {
  const groups = new Map<string, StorageRack[]>();
  racks.forEach((rack) => {
    const code = rackGroupCode(rack.rackCode);
    groups.set(code, [...(groups.get(code) || []), rack]);
  });
  return Array.from(groups, ([groupCode, layers]): RackGroup => ({
    groupCode,
    name: baseRackName(layers[0]),
    layers: layers.toSorted((left, right) =>
      rackLayerNumber(left.rackCode) - rackLayerNumber(right.rackCode) || left.rackCode.localeCompare(right.rackCode),
    ),
  })).toSorted((left, right) => left.groupCode.localeCompare(right.groupCode));
}

export default function Home() {
  const [state, setState] = useState<InventoryState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
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
  const [containerToEdit, setContainerToEdit] = useState<InventoryBox | null>(null);
  const [expandedRackGroups, setExpandedRackGroups] = useState<Record<string, boolean>>({});
  const [expandedRackLayers, setExpandedRackLayers] = useState<Record<string, boolean>>({});
  const [expandedContainers, setExpandedContainers] = useState<Record<string, boolean>>({});

  const loadWarehouse = useCallback(async (token: string, silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const snapshotResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/home_inventory_get_state`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: "{}",
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
      const snapshot = (await snapshotResponse.json()) as SnapshotRow;
      setState(snapshot.payload || { boxes: [], racks: [], binds: [], loans: [] });
      setRevision(snapshot.revision || 0);
      setUpdatedAt(snapshot.updated_at);
      setConflict(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "家庭云端连接失败");
      if (!silent) setState(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const restoredToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!restoredToken) {
      queueMicrotask(() => setRestoringSession(false));
      return;
    }
    queueMicrotask(() => {
      setAccessToken(restoredToken);
      void loadWarehouse(restoredToken).finally(() => setRestoringSession(false));
    });
  }, [loadWarehouse]);

  useEffect(() => {
    if (!accessToken) return;
    const checkForUpdates = async () => {
      if (document.visibilityState !== "visible" || saving || conflict || document.querySelector(".entity-editor")) return;
      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/home_inventory_sync_state?select=revision,updated_at&limit=1`,
          {
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
            cache: "no-store",
          },
        );
        if (!response.ok) return;
        const rows = (await response.json()) as Array<{ revision: number }>;
        if ((rows[0]?.revision || 0) > revision) {
          await loadWarehouse(accessToken, true);
          setSelected(null);
          setContainerToEdit(null);
        }
      } catch {
        // Keep the currently loaded data during a transient poll failure.
      }
    };
    const timer = window.setInterval(() => void checkForUpdates(), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void checkForUpdates(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [accessToken, conflict, loadWarehouse, revision, saving]);

  const saveEntity = useCallback(async (nextSelected: Exclude<SelectedEntity, null>) => {
    if (!accessToken || !state || saving) return;
    setSaving(true);
    setError("");
    setConflict(false);
    const now = new Date().toISOString();
    const nextState = structuredClone(state);
    if (nextSelected.type === "item") {
      nextSelected.value.updatedAt = now;
      nextState.binds = (nextState.binds || []).map((item) => item.id === nextSelected.value.id ? nextSelected.value : item);
    } else if (nextSelected.type === "container") {
      nextSelected.value.updatedAt = now;
      nextState.boxes = (nextState.boxes || []).map((box) => box.boxCode === nextSelected.value.boxCode ? nextSelected.value : box);
    } else {
      nextSelected.value.updatedAt = now;
      nextState.racks = (nextState.racks || []).map((rack) => rack.rackCode === nextSelected.value.rackCode ? nextSelected.value : rack);
    }
    nextState.events = [
      ...(nextState.events || []),
      {
        id: crypto.randomUUID(),
        kindRaw: nextSelected.type === "item" ? "itemUpdated" : nextSelected.type === "container" ? "boxUpdated" : "rackUpdated",
        itemId: nextSelected.type === "item" ? nextSelected.value.id : "",
        boxCode: nextSelected.type === "container" ? nextSelected.value.boxCode : nextSelected.type === "item" ? nextSelected.value.boxCode : "",
        title: nextSelected.type === "item" ? itemName(nextSelected.value) : nextSelected.type === "container" ? nextSelected.value.displayName || nextSelected.value.boxCode : nextSelected.value.name || nextSelected.value.rackCode,
        detail: "网页端编辑",
        quantity: 0,
        createdAt: now,
      },
    ];
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/home_inventory_commit_state`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          expected_revision: revision,
          device_id: "web-browser",
          payload: nextState,
        }),
      });
      const result = await response.json() as CommitResponse & { message?: string };
      if (!response.ok) {
        if (result.message === "SYNC_CONFLICT") {
          setConflict(true);
          throw new Error("云端刚被其他设备修改，本次保存未覆盖它。请重新载入后再编辑。");
        }
        throw new Error(result.message || "无法保存修改");
      }
      setState(nextState);
      setRevision(result.revision);
      setUpdatedAt(result.updated_at);
      setSelected(nextSelected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      throw caught;
    } finally {
      setSaving(false);
    }
  }, [accessToken, revision, saving, state]);

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
    setRevision(0);
    setConflict(false);
    setError("");
    setAuthError("");
  }

  const boxes = useMemo(() => state?.boxes || [], [state?.boxes]);
  const racks = useMemo(() => state?.racks || [], [state?.racks]);
  const items = useMemo(() => state?.binds || [], [state?.binds]);
  const activeLoans = useMemo(() => (state?.loans || []).filter((loan) => !loan.returnedAt), [state?.loans]);
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
  const rackGroups = groupRacks(racks);

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
  const filteredRackGroups = rackGroups.filter((group) => {
    const groupBoxes = boxes.filter((box) => box.rackCode && rackGroupCode(box.rackCode) === group.groupCode);
    return matchesQuery(
      [
        group.name,
        group.groupCode,
        ...group.layers.flatMap((rack) => [rack.name, rack.rackCode, displayRackCode(rack.rackCode)]),
        ...groupBoxes.flatMap((box) => [box.displayName, box.boxCode, box.note]),
      ],
      query,
    );
  });

  const visibleCount = mode === "item" ? filteredItems.length : mode === "container" ? filteredBoxes.length : filteredRackGroups.length;

  function showItemDetails(item: InventoryItem) {
    setContainerToEdit(null);
    setSelected({ type: "item", value: item });
    window.requestAnimationFrame(() => {
      document.getElementById("inventory-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function editContainer(box: InventoryBox) {
    setSelected(null);
    setContainerToEdit(box);
    window.requestAnimationFrame(() => {
      document.getElementById("inventory-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleContainer(boxCode: string) {
    setExpandedContainers((current) => ({ ...current, [boxCode]: !current[boxCode] }));
  }

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
              placeholder="输入访问密码"
              aria-describedby={authError ? "password-error" : undefined}
            />
            {authError && <p className="login-error" id="password-error" role="alert">{authError}</p>}
            <button type="submit" disabled={!password || authenticating}>{authenticating ? "正在验证…" : "验证并进入"}</button>
          </form>
          <small>验证由 Supabase Auth 完成 · 通过 RLS 仅访问家庭数据</small>
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
          <span className="read-only">可编辑</span>
          <span className={`cloud-state ${error ? "offline" : ""}`}>
            <i />{saving ? "正在保存" : loading ? "正在同步" : error ? "连接异常" : "云端已连接"}
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
          <small>修改会直接保存到云端 · 版本 {revision}</small>
        </div>
      </section>

      {conflict && <section className="sync-alert" role="alert">
        <div><b>检测到同步冲突</b><span>云端有更新的版本，已阻止覆盖。</span></div>
        <button onClick={() => { void loadWarehouse(accessToken); setSelected(null); }}>重新载入云端版本</button>
      </section>}

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
            ["rack", "装载架", rackGroups.length],
            ["container", "容器", boxes.length],
            ["item", "物品", items.length],
          ] as const).map(([value, label, count]) => (
            <button key={value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setSelected(null); setContainerToEdit(null); }} role="tab" aria-selected={mode === value}>
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
                return <button className="entity-row" key={item.id} onClick={() => showItemDetails(item)}>
                  <span className="thumb">◇</span>
                  <span className="entity-main"><b>{itemName(item)}</b><small>{[item.spec, item.category].filter(Boolean).join(" · ") || "未分类"}</small><em>{box ? `${box.displayName || box.boxCode} · ${locationOf(box)}` : item.shelfCode || "未指定容器"}</em></span>
                  <span className="entity-end"><strong>{item.quantity || 0}<small>{item.unit || "件"}</small></strong><i className={low ? "warn" : ""}>{low ? "库存偏低" : item.status || "备用"}</i></span>
                </button>;
              })}
              {mode === "container" && filteredBoxes.map((box) => {
                const count = items.filter((item) => item.boxCode === box.boxCode).length;
                const containerExpanded = Boolean(expandedContainers[box.boxCode]);
                return <section className="container-group" key={box.boxCode}>
                  <button className="entity-row container-toggle-row" type="button" aria-expanded={containerExpanded} aria-controls={`container-contents-${box.boxCode}`} onClick={() => toggleContainer(box.boxCode)}>
                    <span className="thumb box">▣</span>
                    <span className="entity-main"><b>{box.displayName || containerTypes[box.containerTypeRaw || ""] || "未命名容器"}</b><small>{box.boxCode} · {contentCategories[box.contentCodeRaw || ""] || "未分类"}</small><em>{locationOf(box)}</em></span>
                    <span className="entity-end"><strong>{count}<small>种</small></strong><span className="container-meta"><i>{box.loadPercent || 0}% 装载</i><i className="tree-chevron" aria-hidden="true">⌄</i></span></span>
                  </button>
                  {containerExpanded && <ContainerContents box={box} boxes={boxes} items={items} expandedContainers={expandedContainers} onToggleContainer={toggleContainer} onSelectItem={showItemDetails} onEditContainer={editContainer} />}
                </section>;
              })}
              {mode === "rack" && filteredRackGroups.map((group) => {
                const groupBoxCount = boxes.filter((box) => box.rackCode && rackGroupCode(box.rackCode) === group.groupCode).length;
                const groupExpanded = Boolean(expandedRackGroups[group.groupCode]) || Boolean(query.trim());
                return <section className="rack-group" key={group.groupCode}>
                  <button
                    className="rack-group-header"
                    type="button"
                    aria-expanded={groupExpanded}
                    aria-controls={`rack-group-${group.groupCode}`}
                    onClick={() => setExpandedRackGroups((current) => ({ ...current, [group.groupCode]: !groupExpanded }))}
                  >
                    <span className="thumb rack">▤</span>
                    <span className="entity-main"><b>{group.name}</b><small>{group.groupCode} · {group.layers.length} 层</small><em>{groupBoxCount ? `${groupBoxCount} 个容器位于此货架` : "当前没有绑定容器"}</em></span>
                    <span className="rack-summary"><strong>{group.layers.length}<small>层</small></strong><i className="tree-chevron" aria-hidden="true">⌄</i></span>
                  </button>
                  {groupExpanded && <div className="rack-layers" id={`rack-group-${group.groupCode}`}>
                    {group.layers.map((rack) => {
                      const layerBoxes = boxes.filter((box) => box.rackCode === rack.rackCode);
                      const layerExpanded = Boolean(expandedRackLayers[rack.rackCode]) || Boolean(query.trim());
                      return <div className="rack-layer" key={rack.rackCode}>
                        <button
                          className="rack-layer-header"
                          type="button"
                          aria-expanded={layerExpanded}
                          aria-controls={`rack-layer-${rack.rackCode}`}
                          onClick={() => {
                            setSelected({ type: "rack", value: rack });
                            setExpandedRackLayers((current) => ({ ...current, [rack.rackCode]: !layerExpanded }));
                          }}
                        >
                          <span className="layer-line" aria-hidden="true" />
                          <span className="layer-badge">{rackLayerNumber(rack.rackCode) || "–"}</span>
                          <span className="entity-main"><b>{rack.name || `${rackLayerNumber(rack.rackCode)} 层`}</b><small>{displayRackCode(rack.rackCode)}</small></span>
                          <span className="layer-count">{layerBoxes.length} 个容器 <i className="tree-chevron" aria-hidden="true">⌄</i></span>
                        </button>
                        {layerExpanded && <div className="layer-containers" id={`rack-layer-${rack.rackCode}`}>
                          {layerBoxes.length ? layerBoxes.map((box) => {
                            const itemCount = items.filter((item) => item.boxCode === box.boxCode).length;
                            const containerExpanded = Boolean(expandedContainers[box.boxCode]);
                            return <section className="rack-container-node" key={box.boxCode}>
                              <button className="rack-container-row" type="button" aria-expanded={containerExpanded} aria-controls={`container-contents-${box.boxCode}`} onClick={() => toggleContainer(box.boxCode)}>
                                <span className="container-branch" aria-hidden="true">└</span>
                                <span className="entity-main"><b>{box.displayName || containerTypes[box.containerTypeRaw || ""] || "未命名容器"}</b><small>{box.boxCode} · {contentCategories[box.contentCodeRaw || ""] || "未分类"}</small></span>
                                <span>{itemCount} 种物品 <i className="tree-chevron" aria-hidden="true">⌄</i></span>
                              </button>
                              {containerExpanded && <ContainerContents box={box} boxes={boxes} items={items} expandedContainers={expandedContainers} onToggleContainer={toggleContainer} onSelectItem={showItemDetails} onEditContainer={editContainer} compact />}
                            </section>;
                          }) : <p className="empty-layer">这一层还没有容器</p>}
                        </div>}
                      </div>;
                    })}
                  </div>}
                </section>;
              })}
            </div>
            <aside className="detail-panel" id="inventory-detail-panel">
              {containerToEdit ? <ContainerEditor
                key={`edit:${containerToEdit.boxCode}`}
                box={containerToEdit}
                boxes={boxes}
                saving={saving}
                onCancel={() => setContainerToEdit(null)}
                onSave={async (box) => {
                  await saveEntity({ type: "container", value: box });
                  setSelected(null);
                  setContainerToEdit(null);
                }}
              /> : selected ? <EntityDetail key={`${selected.type}:${selected.type === "item" ? selected.value.id : selected.type === "container" ? selected.value.boxCode : selected.value.rackCode}`} selected={selected} boxes={boxes} items={items} accessToken={accessToken} saving={saving} onSave={saveEntity} /> : <div className="detail-placeholder"><span>⌖</span><b>选择一件物品</b><p>先展开容器，再点击里面的物品查看完整详情。</p></div>}
            </aside>
          </div>
        )}
      </section>

      <footer><span>航标家庭仓库</span><span>元数据增量同步 · 照片按需读取</span></footer>
    </main>
  );
}

function ContainerContents({
  box,
  boxes,
  items,
  expandedContainers,
  onToggleContainer,
  onSelectItem,
  onEditContainer,
  compact = false,
  ancestors = [],
}: {
  box: InventoryBox;
  boxes: InventoryBox[];
  items: InventoryItem[];
  expandedContainers: Record<string, boolean>;
  onToggleContainer: (boxCode: string) => void;
  onSelectItem: (item: InventoryItem) => void;
  onEditContainer: (box: InventoryBox) => void;
  compact?: boolean;
  ancestors?: string[];
}) {
  const containedItems = items.filter((item) => item.boxCode === box.boxCode);
  const childContainers = boxes.filter((value) => value.parentBoxCode === box.boxCode && !ancestors.includes(value.boxCode));
  const nextAncestors = [...ancestors, box.boxCode];

  return <div className={`container-contents ${compact ? "compact" : ""}`} id={`container-contents-${box.boxCode}`}>
    <div className="container-contents-head">
      <span>{containedItems.length} 种物品{childContainers.length ? ` · ${childContainers.length} 个子容器` : ""}</span>
      <button type="button" onClick={() => onEditContainer(box)}>编辑容器</button>
    </div>
    {containedItems.map((item) => <button className="container-item-row" type="button" key={item.id} onClick={() => onSelectItem(item)}>
      <span className="container-item-icon" aria-hidden="true">◇</span>
      <span className="entity-main"><b>{itemName(item)}</b><small>{[item.spec, item.category, item.status].filter(Boolean).join(" · ") || "未分类"}</small></span>
      <span className="container-item-action"><b>{item.quantity || 0} {item.unit || "件"}</b><small>查看详情 →</small></span>
    </button>)}
    {childContainers.map((child) => {
      const childExpanded = Boolean(expandedContainers[child.boxCode]);
      const childItemCount = items.filter((item) => item.boxCode === child.boxCode).length;
      return <section className="container-child" key={child.boxCode}>
        <div className="container-child-head">
          <button className="container-child-row" type="button" aria-expanded={childExpanded} aria-controls={`container-contents-${child.boxCode}`} onClick={() => onToggleContainer(child.boxCode)}>
            <span aria-hidden="true">▣</span>
            <span className="entity-main"><b>{child.displayName || child.boxCode}</b><small>{child.boxCode} · 子容器</small></span>
            <span>{childItemCount} 种 <i className="tree-chevron" aria-hidden="true">⌄</i></span>
          </button>
          <button className="container-child-edit" type="button" onClick={() => onEditContainer(child)}>编辑</button>
        </div>
        {childExpanded && nextAncestors.length < 8 && <ContainerContents box={child} boxes={boxes} items={items} expandedContainers={expandedContainers} onToggleContainer={onToggleContainer} onSelectItem={onSelectItem} onEditContainer={onEditContainer} compact ancestors={nextAncestors} />}
      </section>;
    })}
    {!containedItems.length && !childContainers.length && <p className="empty-container">这个容器里暂时没有记录物品</p>}
  </div>;
}

function EntityDetail({
  selected,
  boxes,
  items,
  accessToken,
  saving,
  onSave,
}: {
  selected: Exclude<SelectedEntity, null>;
  boxes: InventoryBox[];
  items: InventoryItem[];
  accessToken: string;
  saving: boolean;
  onSave: (selected: Exclude<SelectedEntity, null>) => Promise<void>;
}) {
  const selectedKey = selected.type === "item" ? selected.value.id : selected.type === "container" ? selected.value.boxCode : selected.value.rackCode;
  const cloudPhotoPath = selected.type === "item" || selected.type === "container" ? selected.value.cloudPhotoPath : "";
  const embeddedPhoto = selected.type === "item" || selected.type === "container" ? photoSource(selected.value.photoData) : "";
  const [editing, setEditing] = useState(false);
  const [photoURL, setPhotoURL] = useState(embeddedPhoto);

  useEffect(() => {
    if (!cloudPhotoPath) return;
    let objectURL = "";
    const controller = new AbortController();
    void fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/home-inventory-photos/${cloudPhotoPath}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      objectURL = URL.createObjectURL(await response.blob());
      setPhotoURL(objectURL);
    }).catch(() => {});
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [accessToken, cloudPhotoPath]);

  if (editing) {
    return <EntityEditor
      key={`${selected.type}:${selectedKey}`}
      selected={selected}
      boxes={boxes}
      saving={saving}
      onCancel={() => setEditing(false)}
      onSave={async (value) => {
        await onSave(value);
        setEditing(false);
      }}
    />;
  }

  const editButton = <button className="edit-button" type="button" onClick={() => setEditing(true)}>编辑</button>;
  if (selected.type === "item") {
    const item = selected.value;
    const box = boxes.find((value) => value.boxCode === item.boxCode);
    return <div className="detail-content"><div className="detail-heading"><p className="eyebrow">ITEM DETAIL</p>{editButton}</div><h3>{itemName(item)}</h3>{photoURL && <img className="detail-photo" src={photoURL} alt={itemName(item)} />}<dl><div><dt>数量</dt><dd>{item.quantity || 0} {item.unit || "件"}</dd></div><div><dt>状态</dt><dd>{item.status || "备用"}</dd></div><div><dt>分类</dt><dd>{item.category || "未分类"}</dd></div><div><dt>容器</dt><dd>{box?.displayName || item.boxCode || "未指定"}</dd></div><div><dt>位置</dt><dd>{box ? locationOf(box) : item.shelfCode || "未填写"}</dd></div>{item.expiryDate && <div><dt>到期日</dt><dd>{item.expiryDate}</dd></div>}</dl>{item.note && <p className="note">{item.note}</p>}</div>;
  }
  if (selected.type === "container") {
    const box = selected.value;
    const contained = items.filter((item) => item.boxCode === box.boxCode);
    return <div className="detail-content"><div className="detail-heading"><p className="eyebrow">CONTAINER DETAIL</p>{editButton}</div><h3>{box.displayName || containerTypes[box.containerTypeRaw || ""] || "未命名容器"}</h3><span className="detail-code">{box.boxCode}</span>{photoURL && <img className="detail-photo" src={photoURL} alt={box.displayName || box.boxCode} />}<dl><div><dt>类型</dt><dd>{containerTypes[box.containerTypeRaw || ""] || "其他容器"}</dd></div><div><dt>内容</dt><dd>{contentCategories[box.contentCodeRaw || ""] || "未分类"}</dd></div><div><dt>位置</dt><dd>{locationOf(box)}</dd></div><div><dt>装载率</dt><dd>{box.loadPercent || 0}%</dd></div><div><dt>物品</dt><dd>{contained.length} 种</dd></div></dl>{contained.length > 0 && <ul className="mini-list">{contained.slice(0, 5).map((item) => <li key={item.id}><span>{itemName(item)}</span><b>{item.quantity || 0} {item.unit || "件"}</b></li>)}</ul>}{box.note && <p className="note">{box.note}</p>}</div>;
  }
  const rack = selected.value;
  const rackBoxes = boxes.filter((box) => box.rackCode === rack.rackCode);
  return <div className="detail-content"><div className="detail-heading"><p className="eyebrow">RACK DETAIL</p>{editButton}</div><h3>{rack.name || `装载架 ${rack.rackCode}`}</h3><span className="detail-code">{rack.rackCode}</span><dl><div><dt>绑定容器</dt><dd>{rackBoxes.length} 个</dd></div><div><dt>最近更新</dt><dd>{formatTime(rack.updatedAt)}</dd></div></dl>{rackBoxes.length > 0 && <ul className="mini-list">{rackBoxes.map((box) => <li key={box.boxCode}><span>{box.displayName || box.boxCode}</span><b>{box.loadPercent || 0}%</b></li>)}</ul>}</div>;
}

function EntityEditor({
  selected,
  boxes,
  saving,
  onCancel,
  onSave,
}: {
  selected: Exclude<SelectedEntity, null>;
  boxes: InventoryBox[];
  saving: boolean;
  onCancel: () => void;
  onSave: (selected: Exclude<SelectedEntity, null>) => Promise<void>;
}) {
  if (selected.type === "item") {
    return <ItemEditor item={selected.value} boxes={boxes} saving={saving} onCancel={onCancel} onSave={(value) => onSave({ type: "item", value })} />;
  }
  if (selected.type === "container") {
    return <ContainerEditor box={selected.value} boxes={boxes} saving={saving} onCancel={onCancel} onSave={(value) => onSave({ type: "container", value })} />;
  }
  return <RackEditor rack={selected.value} saving={saving} onCancel={onCancel} onSave={(value) => onSave({ type: "rack", value })} />;
}

function EditorActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return <div className="editor-actions"><button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>取消</button><button type="submit" className="save-button" disabled={saving}>{saving ? "正在保存…" : "保存到云端"}</button></div>;
}

function ItemEditor({ item, boxes, saving, onCancel, onSave }: { item: InventoryItem; boxes: InventoryBox[]; saving: boolean; onCancel: () => void; onSave: (item: InventoryItem) => Promise<void> }) {
  const [draft, setDraft] = useState(() => structuredClone(item));
  return <form className="entity-editor" onSubmit={(event) => { event.preventDefault(); void onSave(draft).catch(() => {}); }}>
    <div className="detail-heading"><p className="eyebrow">EDIT ITEM</p><span className="detail-code">{draft.materialCode || draft.id.slice(0, 8)}</span></div>
    <label>物品名称<input required value={draft.materialName || ""} onChange={(event) => setDraft({ ...draft, materialName: event.target.value })} /></label>
    <div className="editor-grid"><label>数量<input type="number" min="0" value={draft.quantity ?? 0} onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })} /></label><label>单位<input value={draft.unit || ""} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label></div>
    <label>所在容器<select value={draft.boxCode || ""} onChange={(event) => setDraft({ ...draft, boxCode: event.target.value })}><option value="">未指定</option>{boxes.map((box) => <option key={box.boxCode} value={box.boxCode}>{box.displayName || box.boxCode}</option>)}</select></label>
    <div className="editor-grid"><label>状态<input value={draft.status || ""} onChange={(event) => setDraft({ ...draft, status: event.target.value })} /></label><label>分类<input value={draft.category || ""} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label></div>
    <label>规格<input value={draft.spec || ""} onChange={(event) => setDraft({ ...draft, spec: event.target.value })} /></label>
    <label>关键词<input value={draft.keywords || ""} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} /></label>
    <div className="editor-grid"><label>到期日期<input type="date" value={draft.expiryDate || ""} onChange={(event) => setDraft({ ...draft, expiryDate: event.target.value })} /></label><label>低库存阈值<input type="number" min="0" value={draft.lowStockThreshold ?? ""} onChange={(event) => setDraft({ ...draft, lowStockThreshold: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>
    <label>备注<textarea rows={4} value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
    <EditorActions saving={saving} onCancel={onCancel} />
  </form>;
}

function ContainerEditor({ box, boxes, saving, onCancel, onSave }: { box: InventoryBox; boxes: InventoryBox[]; saving: boolean; onCancel: () => void; onSave: (box: InventoryBox) => Promise<void> }) {
  const [draft, setDraft] = useState(() => structuredClone(box));
  return <form className="entity-editor" onSubmit={(event) => { event.preventDefault(); void onSave(draft).catch(() => {}); }}>
    <div className="detail-heading"><p className="eyebrow">EDIT CONTAINER</p><span className="detail-code">{draft.boxCode}</span></div>
    <label>容器名称<input value={draft.displayName || ""} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
    <div className="editor-grid"><label>容器类型<select value={draft.containerTypeRaw || "OT"} onChange={(event) => setDraft({ ...draft, containerTypeRaw: event.target.value })}>{Object.entries(containerTypes).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label>内容分类<select value={draft.contentCodeRaw || "OT"} onChange={(event) => setDraft({ ...draft, contentCodeRaw: event.target.value })}>{Object.entries(contentCategories).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label></div>
    <label>装载率 <span className="range-value">{draft.loadPercent || 0}%</span><input type="range" min="0" max="100" step="10" value={draft.loadPercent || 0} onChange={(event) => setDraft({ ...draft, loadPercent: Number(event.target.value) })} /></label>
    <label>上级容器<select value={draft.parentBoxCode || ""} onChange={(event) => setDraft({ ...draft, parentBoxCode: event.target.value, rackCode: event.target.value ? "" : draft.rackCode })}><option value="">无</option>{boxes.filter((value) => value.boxCode !== draft.boxCode).map((value) => <option key={value.boxCode} value={value.boxCode}>{value.displayName || value.boxCode}</option>)}</select></label>
    <div className="editor-grid"><label>装载架层位<input value={draft.rackCode || ""} disabled={Boolean(draft.parentBoxCode)} onChange={(event) => setDraft({ ...draft, rackCode: event.target.value })} /></label><label>房间<input value={draft.roomName || ""} onChange={(event) => setDraft({ ...draft, roomName: event.target.value })} /></label></div>
    <div className="editor-grid"><label>柜体<input value={draft.cabinetName || ""} onChange={(event) => setDraft({ ...draft, cabinetName: event.target.value })} /></label><label>抽屉<input value={draft.drawerName || ""} onChange={(event) => setDraft({ ...draft, drawerName: event.target.value })} /></label></div>
    <label>备注<textarea rows={4} value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
    <EditorActions saving={saving} onCancel={onCancel} />
  </form>;
}

function RackEditor({ rack, saving, onCancel, onSave }: { rack: StorageRack; saving: boolean; onCancel: () => void; onSave: (rack: StorageRack) => Promise<void> }) {
  const [draft, setDraft] = useState(() => structuredClone(rack));
  return <form className="entity-editor" onSubmit={(event) => { event.preventDefault(); void onSave(draft).catch(() => {}); }}>
    <div className="detail-heading"><p className="eyebrow">EDIT RACK LAYER</p><span className="detail-code">{draft.rackCode}</span></div>
    <label>层位名称<input required value={draft.name || ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <p className="editor-help">层位编号不在网页端修改，避免已绑定容器失去位置。</p>
    <EditorActions saving={saving} onCancel={onCancel} />
  </form>;
}
