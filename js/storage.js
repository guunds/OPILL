// storage.js — localStorage helpers with session management
const Storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  del(key) {
    try { localStorage.removeItem(key); return true; }
    catch { return false; }
  },

  SESSION_KEY: 'wallet_session',
  ACTIVITY_KEY: 'wallet_last_activity',
  TIMEOUT_MS: 30 * 60 * 1000,

  saveSession(provider, address) {
    this.set(this.SESSION_KEY, { provider, address, savedAt: Date.now() });
    this.touchActivity();
  },

  getSession() {
    const s = this.get(this.SESSION_KEY);
    if (!s) return null;
    const lastActivity = this.get(this.ACTIVITY_KEY, 0);
    const elapsed = Date.now() - lastActivity;
    if (elapsed > this.TIMEOUT_MS) {
      this.clearSession();
      return null;
    }
    return s;
  },

  clearSession() {
    this.del(this.SESSION_KEY);
    this.del(this.ACTIVITY_KEY);
  },

  touchActivity() {
    this.set(this.ACTIVITY_KEY, Date.now());
  },

  setFaucetClaim(tokenSymbol) {
    this.set(`faucet_claim_${tokenSymbol}`, Date.now());
  },
  getFaucetCooldown(tokenSymbol, cooldownMs) {
    const last = this.get(`faucet_claim_${tokenSymbol}`, 0);
    const remaining = cooldownMs - (Date.now() - last);
    return Math.max(0, remaining);
  },
  addLocalTx(tx) {
    const list = this.get('local_txns', []);
    list.unshift(tx);
    this.set('local_txns', list.slice(0, 100));
  },
  getLocalTxns() {
    return this.get('local_txns', []);
  }
};
window.Storage = Storage;
