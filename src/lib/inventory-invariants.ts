type VariantQuantity = { variantId: string | null; quantity: number };

/** Stable, locale-independent ID ordering across writers and request snapshots. */
export function compareStableIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Exact whole-order matching; missing, nonpositive or orphaned rows are ambiguous. */
export function exactVariantQuantities(expected: readonly VariantQuantity[], actual: readonly VariantQuantity[]) {
  if (!expected.length || !actual.length) return false;
  const sums = (rows: readonly VariantQuantity[]) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.variantId || !Number.isSafeInteger(row.quantity) || row.quantity <= 0) return null;
      const sum = (map.get(row.variantId) ?? 0) + row.quantity;
      if (!Number.isSafeInteger(sum)) return null;
      map.set(row.variantId, sum);
    }
    return map;
  };
  const expectedSums = sums(expected);
  const actualSums = sums(actual);
  return Boolean(expectedSums && actualSums && expectedSums.size === actualSums.size
    && [...expectedSums].every(([variantId, quantity]) => actualSums.get(variantId) === quantity));
}
