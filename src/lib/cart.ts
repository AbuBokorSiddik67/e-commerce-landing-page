export const CART_STORAGE_KEY = "landiq:cart:v1";

export type CartItem = {
  productId: string;
  slug: string;
  productName: string;
  variantId: string;
  variantName: string;
  quantity: number;
};

/** Cart data is only a browser convenience; checkout revalidates prices and stock on the server. */
export function readCart(storage: Storage): CartItem[] {
  const raw = storage.getItem(CART_STORAGE_KEY);
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).filter((item): item is CartItem => Boolean(item && typeof item === "object"
    && typeof item.productId === "string" && item.productId.length > 0 && item.productId.length <= 200
    && typeof item.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) && item.slug.length <= 100
    && typeof item.productName === "string" && item.productName.length > 0 && item.productName.length <= 200
    && typeof item.variantId === "string" && item.variantId.length > 0 && item.variantId.length <= 200
    && typeof item.variantName === "string" && item.variantName.length > 0 && item.variantName.length <= 200
    && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 50));
}

export function saveCart(storage: Storage, items: CartItem[]) {
  storage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
}

export function addCartItem(storage: Storage, item: CartItem) {
  const items = readCart(storage);
  const index = items.findIndex((candidate) => candidate.productId === item.productId && candidate.variantId === item.variantId);
  if (index >= 0) {
    const quantity = items[index].quantity + item.quantity;
    if (quantity > 50) throw new Error("The maximum quantity is 50 per cart item.");
    items[index] = { ...item, quantity };
  }
  else {
    if (items.length >= 50) throw new Error("The cart is full. Remove an item before adding another.");
    items.push(item);
  }
  saveCart(storage, items);
}

export function removeOrderedCartItem(storage: Storage, productId: string, variantId: string, quantity: number) {
  const items = readCart(storage);
  saveCart(storage, items.filter((item) => !(item.productId === productId && item.variantId === variantId && item.quantity === quantity)));
}
