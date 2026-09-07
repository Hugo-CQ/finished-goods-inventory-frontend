/** Apply only changed fields; an old draft cannot overwrite another device's newer field. */
export function rebaseDraft<T extends object>(base: T, draft: T, current: T): T {
  const result = { ...current };
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)] as Array<keyof T>);
  for (const key of keys) {
    if (key === "updatedAt") continue;
    const oldValue = JSON.stringify(base[key]);
    const nextValue = JSON.stringify(draft[key]);
    if (oldValue === nextValue) continue;
    const remoteValue = JSON.stringify(current[key]);
    if (remoteValue !== oldValue && remoteValue !== nextValue) {
      throw new Error("同一项资料已在另一台设备修改。草稿已保留，请核对最新资料后再保存。");
    }
    if (key in draft) result[key] = draft[key];
    else delete result[key];
  }
  return result;
}

export function draftStorageKey(kind: string, id: string) { return `home-inventory-draft:${kind}:${id}`; }

export function validContainerParent(boxes: Array<{ boxCode: string; parentBoxCode?: string }>, id: string, parent: string): boolean {
  const seen = new Set([id]);
  let code = parent;
  while (code) {
    if (seen.has(code)) return false;
    seen.add(code);
    const box = boxes.find((value) => value.boxCode === code);
    if (!box) return false;
    code = box.parentBoxCode || "";
  }
  return true;
}
