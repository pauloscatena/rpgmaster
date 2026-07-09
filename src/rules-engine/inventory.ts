import { randomUUID } from 'node:crypto';
import type { InventoryItem } from './types';

export function usedSlots(items: InventoryItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

export function canFit(items: InventoryItem[], capacity: number, addQty: number): boolean {
  return usedSlots(items) + addQty <= capacity;
}

export function findItem(items: InventoryItem[], itemRef: string): InventoryItem | undefined {
  const ref = itemRef.trim().toLowerCase();
  const byId = items.find((i) => i.id.toLowerCase() === ref);
  if (byId) return byId;
  const byName = items.filter((i) => i.name.toLowerCase() === ref);
  return byName.length === 1 ? byName[0] : byName[0];
}

function sameStack(a: InventoryItem, b: Omit<InventoryItem, 'id' | 'qty'>): boolean {
  return (
    a.name.toLowerCase() === b.name.toLowerCase() &&
    a.usable === b.usable &&
    a.readable === b.readable &&
    a.description === b.description
  );
}

export function addItem(
  items: InventoryItem[],
  capacity: number,
  item: Omit<InventoryItem, 'id'> & { id?: string }
): { ok: true; items: InventoryItem[] } | { ok: false; error: string } {
  if (item.qty < 1 || !Number.isInteger(item.qty)) {
    return { ok: false, error: 'Quantidade inválida.' };
  }
  if (!canFit(items, capacity, item.qty)) {
    return { ok: false, error: 'A bolsa está cheia.' };
  }
  const existing = items.find((i) => sameStack(i, item));
  if (existing) {
    return {
      ok: true,
      items: items.map((i) => (i.id === existing.id ? { ...i, qty: i.qty + item.qty } : i)),
    };
  }
  const created: InventoryItem = {
    id: item.id ?? randomUUID(),
    name: item.name,
    qty: item.qty,
    description: item.description,
    usable: item.usable,
    readable: item.readable,
  };
  return { ok: true, items: [...items, created] };
}

export function removeItem(
  items: InventoryItem[],
  itemRef: string,
  qty: number
): { ok: true; items: InventoryItem[]; removed: InventoryItem } | { ok: false; error: string } {
  if (qty < 1 || !Number.isInteger(qty)) {
    return { ok: false, error: 'Quantidade inválida.' };
  }
  const found = findItem(items, itemRef);
  if (!found) return { ok: false, error: `Item "${itemRef}" não encontrado.` };
  if (found.qty < qty) return { ok: false, error: 'Quantidade insuficiente.' };
  const nextQty = found.qty - qty;
  const next =
    nextQty === 0 ? items.filter((i) => i.id !== found.id) : items.map((i) => (i.id === found.id ? { ...i, qty: nextQty } : i));
  return { ok: true, items: next, removed: { ...found, qty } };
}

export function transferItem(
  from: InventoryItem[],
  to: InventoryItem[],
  toCapacity: number,
  itemRef: string,
  qty: number
): { ok: true; from: InventoryItem[]; to: InventoryItem[] } | { ok: false; error: string } {
  const removed = removeItem(from, itemRef, qty);
  if (!removed.ok) return removed;
  const added = addItem(to, toCapacity, {
    name: removed.removed.name,
    qty: removed.removed.qty,
    description: removed.removed.description,
    usable: removed.removed.usable,
    readable: removed.removed.readable,
  });
  if (!added.ok) return added;
  return { ok: true, from: removed.items, to: added.items };
}

/** Converte inventário legado (string[]) ou JSON misto para InventoryItem[]. */
export function normalizeInventory(raw: unknown): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') {
      return {
        id: randomUUID(),
        name: entry,
        qty: 1,
        description: '',
        usable: true,
        readable: false,
      };
    }
    const obj = entry as Partial<InventoryItem>;
    return {
      id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
      name: typeof obj.name === 'string' ? obj.name : 'item',
      qty: typeof obj.qty === 'number' && obj.qty >= 1 ? Math.floor(obj.qty) : 1,
      description: typeof obj.description === 'string' ? obj.description : '',
      usable: typeof obj.usable === 'boolean' ? obj.usable : true,
      readable: typeof obj.readable === 'boolean' ? obj.readable : false,
    };
  });
}
