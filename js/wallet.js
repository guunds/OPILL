// wallet.js — OPILL Protocol Bitcoin Wallet Integration
// Mendukung: UniSat, OKX, Xverse
// API kompatibel dengan KEDUA gaya: Wallet.state.address DAN Wallet.getAddress()

const Wallet = (() => {

  // ── State terpusat (kompatibel dengan index.html yang pakai Wallet.state.xxx) ──
  const state = {
    connected: false,
    type: null,       // 'unisat' | 'okx' | 'xverse'
    address: null,
    publicKey: null,
    balance: 0,       // dalam satoshi
    network: 'testnet'
  };

  // Metadata tampilan wallet
  const META = {
    unisat: { name: 'UniSat Wallet',  icon: '🟠', color: '#FF9500' },
    okx:    { name: 'OKX Wallet',     icon: '⚫', color: '#000000' },
    xverse: { name: 'Xverse Wallet',  icon: '🔷', color: '#7B3FE4' },
  };

  // ── Event emitter ──
  const _listeners = {};
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (_) {} });
  }
  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }
  // Alias untuk kompatibilitas kode lama: Wallet.onEvent(fn)
  function onEvent(fn) {
    ['connect','disconnect','balance','error','accountChanged'].forEach(ev => on(ev, (data) => fn(ev, data)));
  }

  // ── Deteksi wallet yang ter-install ──
  function detectInstalled() {
    return {
      unisat: !!(window.unisat),
      okx:    !!(window.okxwallet?.bitcoin),
      xverse: !!(window.BitcoinProvider),
    };
  }
  function detectWallets() {
    const inst = detectInstalled();
    return Object.keys(META)
      .filter(id => inst[id])
      .map(id => ({ id, ...META[id], status: 'Detected' }));
  }

  // ── Ambil provider object ──
  function _getProvider(type) {
    if (type === 'unisat') return window.unisat;
    if (type === 'okx')    return window.okxwallet?.bitcoin;
    if (type === 'xverse') return window.BitcoinProvider;
    throw new Error('Unknown wallet type: ' + type);
  }

  // ── Connect ──
  async function connect(type) {
    try {
      let address, publicKey;

      if (type === 'unisat') {
        if (!window.unisat) throw new Error('UniSat Wallet belum ter-install. Download di unisat.io');
        const accounts = await window.unisat.requestAccounts();
        if (!accounts?.length) throw new Error('Tidak ada akun yang tersedia');
        address   = accounts[0];
        publicKey = await window.unisat.getPublicKey();
        // Switch ke testnet
        try { await window.unisat.switchNetwork('testnet'); } catch (_) {}

      } else if (type === 'okx') {
        if (!window.okxwallet?.bitcoin) throw new Error('OKX Wallet belum ter-install. Download di okx.com');
        const result = await window.okxwallet.bitcoin.connect();
        address   = result?.address;
        publicKey = result?.publicKey;
        if (!address) throw new Error('OKX tidak mengembalikan alamat');

      } else if (type === 'xverse') {
        if (!window.BitcoinProvider) throw new Error('Xverse belum ter-install. Download di xverse.app');
        const resp = await window.BitcoinProvider.connect({ message: 'Connect to OPILL Protocol' });
        address   = resp?.addresses?.[0]?.address;
        publicKey = resp?.addresses?.[0]?.publicKey;
        if (!address) throw new Error('Xverse tidak mengembalikan alamat');

      } else {
        throw new Error('Tipe wallet tidak dikenal: ' + type);
      }

      // Simpan ke state
      state.connected  = true;
      state.type       = type;
      state.address    = address;
      state.publicKey  = publicKey;

      // Ambil balance BTC
      await refreshBtcBalance();

      // Simpan session
      try { sessionStorage.setItem('opill_wallet', type); } catch (_) {}
      try {
        localStorage.setItem('wallet_session', JSON.stringify({
          provider: type, address, savedAt: Date.now()
        }));
        localStorage.setItem('wallet_last_activity', String(Date.now()));
      } catch (_) {}

      // Listen perubahan akun
      _listenChanges(type);

      _emit('connect', { address, provider: type, type, publicKey });
      console.log('[Wallet] Connected:', type, address);
      return { address, publicKey };

    } catch (err) {
      _emit('error', { message: err.message });
      throw err;
    }
  }

  // ── Disconnect ──
  function disconnect() {
    state.connected = false;
    state.type      = null;
    state.address   = null;
    state.publicKey = null;
    state.balance   = 0;
    try { sessionStorage.removeItem('opill_wallet'); } catch (_) {}
    try { localStorage.removeItem('wallet_session'); } catch (_) {}
    _emit('disconnect', {});
  }

  // ── Auto-reconnect saat halaman dibuka ──
  async function tryAutoReconnect() {
    try {
      const saved = sessionStorage.getItem('opill_wallet');
      if (!saved) return false;
      const inst = detectInstalled();
      if (!inst[saved]) return false;
      await connect(saved);
      return true;
    } catch (_) {
      try { sessionStorage.removeItem('opill_wallet'); } catch (__) {}
      return false;
    }
  }
  // Alias untuk kompatibilitas wallet.js lama
  async function restoreSession() { return tryAutoReconnect(); }

  // ── Fetch BTC Balance ──
  async function refreshBtcBalance() {
    if (!state.connected || !state.address) return 0;
    try {
      let sats = 0;
      if (state.type === 'unisat') {
        const b = await window.unisat.getBalance();
        sats = b?.total ?? b?.confirmed ?? 0;
      } else if (state.type === 'okx') {
        const b = await window.okxwallet.bitcoin.getBalance();
        sats = b?.total ?? b?.confirmed ?? 0;
      } else {
        // Xverse atau fallback: pakai mempool.space testnet4
        const res = await fetch(`https://mempool.space/testnet4/api/address/${state.address}`);
        if (res.ok) {
          const d = await res.json();
          sats = (d.chain_stats.funded_txo_sum - d.chain_stats.spent_txo_sum);
        }
      }
      state.balance = sats;
      _emit('balance', { sats, btc: satsToBtc(sats) });
      return sats;
    } catch (e) {
      console.warn('[Wallet] Balance error:', e.message);
      return state.balance;
    }
  }
  // Alias untuk kode lama
  function getBtcBalance() { return state.balance / 1e8; }

  // ── Sign Pesan ──
  async function signMessage(message) {
    if (!state.connected) throw new Error('Wallet belum terhubung');
    const p = _getProvider(state.type);
    if (state.type === 'unisat' || state.type === 'okx') {
      return await p.signMessage(message);
    }
    if (state.type === 'xverse') {
      const r = await p.request('signMessage', { message, address: state.address });
      return r?.result?.signature;
    }
    throw new Error('signMessage tidak didukung untuk: ' + state.type);
  }

  // ── Sign PSBT ──
  async function signPsbt(psbtHex, options = {}) {
    if (!state.connected) throw new Error('Wallet belum terhubung');
    const p = _getProvider(state.type);
    if (state.type === 'unisat') {
      return await p.signPsbt(psbtHex, options);
    }
    if (state.type === 'okx') {
      return await p.signPsbt(psbtHex, options);
    }
    if (state.type === 'xverse') {
      const r = await p.request('signPsbt', { psbt: psbtHex, ...options });
      return r?.result?.psbt;
    }
    throw new Error('signPsbt tidak didukung untuk: ' + state.type);
  }

  // ── Broadcast raw tx lewat mempool.space ──
  async function broadcastTx(txHex) {
    // Coba UniSat pushTx dulu (lebih cepat)
    if (state.type === 'unisat') {
      try {
        const txid = await window.unisat.pushTx({ rawtx: txHex });
        return txid;
      } catch (_) {}
    }
    // Fallback: mempool.space testnet4
    const res = await fetch('https://mempool.space/testnet4/api/tx', {
      method: 'POST',
      body: txHex,
      headers: { 'Content-Type': 'text/plain' }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Broadcast gagal: ' + err);
    }
    return await res.text(); // txid
  }

  // ── Listen perubahan akun ──
  function _listenChanges(type) {
    const onAccounts = async (accounts) => {
      if (!accounts?.length) { disconnect(); return; }
      state.address = accounts[0];
      try { state.publicKey = await _getProvider(type).getPublicKey?.(); } catch (_) {}
      await refreshBtcBalance();
      _emit('accountChanged', { address: accounts[0] });
    };
    try {
      if (type === 'unisat') window.unisat.on?.('accountsChanged', onAccounts);
      if (type === 'okx')    window.okxwallet.bitcoin.on?.('accountsChanged', onAccounts);
    } catch (_) {}
  }

  // ── Helper ──
  function satsToBtc(sats)        { return (sats / 1e8).toFixed(8); }
  function shortAddr(addr, n = 8) { if (!addr) return '—'; return addr.slice(0, n) + '…' + addr.slice(-6); }
  function shortenAddress(addr)   { return shortAddr(addr); }
  function isConnected()          { return state.connected; }
  function getAddress()           { return state.address; }
  function getPubkey()            { return state.publicKey; }
  function getProvider()          { return state.type; }

  return {
    // State langsung (kompatibel dengan Wallet.state.address di index.html)
    state, META,
    // Methods utama
    connect, disconnect,
    tryAutoReconnect, restoreSession,
    refreshBtcBalance, fetchBalance: refreshBtcBalance,
    signMessage, signPsbt, broadcastTx,
    // Detection
    detectInstalled, detectWallets,
    // Helpers
    satsToBtc, shortAddr, shortenAddress,
    isConnected, getAddress, getPubkey, getProvider, getBtcBalance,
    // Events
    on, onEvent
  };
})();

window.Wallet = Wallet;
