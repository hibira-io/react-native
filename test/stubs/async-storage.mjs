const items = new Map();
export default {
  items,
  async getItem(k) {
    return items.has(k) ? items.get(k) : null;
  },
  async setItem(k, v) {
    items.set(k, v);
  },
  async removeItem(k) {
    items.delete(k);
  },
};
