import { describe, it, expect } from 'vitest';
import { addItem, removeItem, transferItem, usedSlots } from '../../src/rules-engine/inventory';

describe('inventory', () => {
  it('soma slots por qty', () => {
    expect(usedSlots([{ id: '1', name: 'Poção', qty: 3, description: '', usable: true, readable: false }])).toBe(3);
  });

  it('rejeita adicionar além da capacidade', () => {
    const r = addItem([], 2, { name: 'Pedra', qty: 3, description: '', usable: false, readable: false });
    expect(r.ok).toBe(false);
  });

  it('empilha itens iguais', () => {
    const a = addItem([], 10, { name: 'Poção', qty: 1, description: '', usable: true, readable: false });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = addItem(a.items, 10, { name: 'Poção', qty: 2, description: '', usable: true, readable: false });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.items).toHaveLength(1);
    expect(b.items[0]!.qty).toBe(3);
  });

  it('transfere entre bolsas', () => {
    const a = addItem([], 10, { name: 'Chave', qty: 1, description: '', usable: false, readable: false });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const t = transferItem(a.items, [], 10, 'Chave', 1);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.from).toHaveLength(0);
    expect(t.to[0]!.name).toBe('Chave');
  });

  it('remove e zera entrada', () => {
    const a = addItem([], 10, { name: 'Poção', qty: 1, description: '', usable: true, readable: false });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = removeItem(a.items, 'Poção', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(0);
  });
});
