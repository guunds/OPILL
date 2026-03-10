// wallet.js — Bitcoin wallet integration
// Supports: OP_WALLET (window.opnet), UniSat (window.unisat), OKX, Xverse
// OP_WALLET is a fork of UniSat — same API, injected at window.opnet
// Priority: OP_WALLET > UniSat > OKX > Xverse

const Wallet = (() => {
  let _address    = null;
  let _pubkey     = null;
  let _provider   = null; // 'opwallet' | 'unisat' | 'okx' | 'xverse'
  let _providerObj = null; // the actual window.xxx object
  let _btcBalance = 0;
  let _activityTimer = null;

  const LISTENERS = [];
  function emit(event, data) {
    LISTENERS.forEach(fn => { try { fn(event, data); } catch(e) { console.warn('[Wallet] listener err', e); } });
  }

  // ——— Activity tracking for auto-logout ———
  function _startActivityTracking() {
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    events.forEach(e => document.addEventListener(e, _onActivity, { passive: true }));
    if (_activityTimer) clearInterval(_activityTimer);
    _activityTimer = setInterval(() => {
      if (!_address) return;
      const session = Storage.getSession();
      if (!session) {
        console.log('[Wallet] Session expired, auto-logout');
        disconnect();
        if (typeof toast !== 'undefined') toast('Session expired', 'Logged out due to inactivity', 'info');
      }
    }, 60_000);
  }

  function _onActivity() { Storage.touchActivity(); }

  // ——— Get the provider object for a given type ———
  function _getProviderObj(type) {
    switch (type) {
      case 'opwallet': return window.opnet || null;
      case 'unisat':   return window.unisat || null;
      case 'okx':      return window.okxwallet?.bitcoin || null;
      case 'xverse':   return window.BitcoinProvider || window.XverseProviders?.BitcoinProvider || null;
      default: return null;
    }
  }

  // ——— Detect available wallets ———
  function detectWallets() {
    const wallets = [];
    if (window.opnet)                    wallets.push({ id: 'opwallet', name: 'OP_WALLET',    icon: '🟠', detected: true });
    if (window.unisat)                   wallets.push({ id: 'unisat',   name: 'UniSat Wallet', icon: '🟡', detected: true });
    if (window.okxwallet?.bitcoin)       wallets.push({ id: 'okx',      name: 'OKX Wallet',    icon: '⚫', detected: true });
    if (window.BitcoinProvider || window.XverseProviders?.BitcoinProvider)
                                         wallets.push({ id: 'xverse',   name: 'Xverse',        icon: '🔷', detected: true });
    return wallets;
  }

  // ——— Connect ———
  async function connect(providerId) {
    try {
      const provObj = _getProviderObj(providerId);
      if (!provObj) throw new Error(`${providerId} wallet not installed`);

      let address, pubkey;

      if (providerId === 'opwallet' || providerId === 'unisat') {
        // OP_WALLET is a fork of UniSat — identical API
        const accounts = await provObj.requestAccounts();
        if (!accounts?.length) throw new Error('No accounts returned');
        address = accounts[0];
        try { pubkey = await provObj.getPublicKey(); } catch {}
        // Switch to testnet
        try { await provObj.switchNetwork('testnet'); } catch {}

      } else if (providerId === 'okx') {
        const accs = await provObj.connect();
        address = accs?.address;
        pubkey  = accs?.publicKey;
        if (!address) throw new Error('No address returned');

      } else if (providerId === 'xverse') {
        const resp = await provObj.connect({ message: 'Connect to OPILL Protocol' });
        address = resp?.addresses?.[0]?.address;
        pubkey  = resp?.addresses?.[0]?.publicKey;
        if (!address) throw new Error('No address returned');

      } else {
        throw new Error('Unknown provider: ' + providerId);
      }

      _address     = address;
      _pubkey      = pubkey;
      _provider    = providerId;
      _providerObj = provObj;

      await refreshBtcBalance();
      Storage.saveSession(_provider, _address);
      _startActivityTracking();
      emit('connect', { address: _address, provider: _provider, pubkey: _pubkey });
      return { address: _address, pubkey: _pubkey };

    } catch (err) {
      emit('error', { message: err.message });
      throw err;
    }
  }

  // ——— Disconnect ———
  function disconnect() {
    _address = _pubkey = _provider = _providerObj = null;
    _btcBalance = 0;
    if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
    Storage.clearSession();
    emit('disconnect', {});
  }

  // ——— Restore session on page load ———
  async function restoreSession() {
    const s = Storage.getSession();
    if (!s) return false;
    try {
      const provObj = _getProviderObj(s.provider);
      if (!provObj) { Storage.clearSession(); return false; }

      let address;
      if (s.provider === 'opwallet' || s.provider === 'unisat') {
        const accounts = await provObj.getAccounts();
        address = accounts?.[0];
      } else if (s.provider === 'okx') {
        // OKX doesn't have getAccounts without connect, skip silent restore
        Storage.clearSession(); return false;
      } else if (s.provider === 'xverse') {
        Storage.clearSession(); return false;
      }

      if (!address) { Storage.clearSession(); return false; }

      _address     = address;
      _provider    = s.provider;
      _providerObj = provObj;
      try { _pubkey = await provObj.getPublicKey(); } catch {}
      await refreshBtcBalance();
      Storage.saveSession(_provider, _address);
      _startActivityTracking();
      emit('connect', { address: _address, provider: _provider, pubkey: _pubkey });
      return true;
    } catch {
      Storage.clearSession();
      return false;
    }
  }

  // ——— BTC balance ———
  async function refreshBtcBalance() {
    if (!_address) return 0;
    try {
      // Try mempool.space testnet4 first
      const res = await fetch(`https://mempool.space/testnet4/api/address/${_address}`);
      if (res.ok) {
        const data = await res.json();
        const sats = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum);
        _btcBalance = sats / 1e8;
        emit('balance', { btc: _btcBalance, sats });
        return _btcBalance;
      }
    } catch {}
    try {
      // Fallback: wallet native getBalance
      if (_providerObj?.getBalance) {
        const b = await _providerObj.getBalance();
        _btcBalance = (b?.total || b?.confirmed || 0) / 1e8;
        emit('balance', { btc: _btcBalance });
        return _btcBalance;
      }
    } catch {}
    return _btcBalance;
  }

  // ——— Send native BTC (tBTC) ———
  // Works with OP_WALLET / UniSat: provider.sendBitcoin(toAddress, satoshis)
  async function sendBitcoin(toAddress, satoshis) {
    if (!_provider || !_providerObj) throw new Error('Wallet not connected');
    if (typeof satoshis !== 'number' || satoshis <= 0) throw new Error('Invalid amount');

    if (_provider === 'opwallet' || _provider === 'unisat') {
      // OP_WALLET & UniSat: sendBitcoin(address, satoshis) -> returns txid
      const txid = await _providerObj.sendBitcoin(toAddress, satoshis);
      return txid;
    }

    if (_provider === 'okx') {
      const result = await window.okxwallet.bitcoin.sendBitcoin(toAddress, satoshis);
      return result?.txhash || result;
    }

    if (_provider === 'xverse') {
      // Xverse uses sendBtcTransaction
      return new Promise((resolve, reject) => {
        window.BitcoinProvider.sendBtcTransaction({
          payload: {
            network: { type: 'Testnet' },
            recipients: [{ address: toAddress, amountSats: BigInt(satoshis) }],
            senderAddress: _address
          },
          onFinish: (resp) => resolve(resp),
          onCancel: () => reject(new Error('User cancelled'))
        });
      });
    }

    throw new Error('sendBitcoin not supported for: ' + _provider);
  }

  // ——— Sign PSBT ———
  async function signPsbt(psbtHex, options = {}) {
    if (!_provider || !_providerObj) throw new Error('Wallet not connected');
    if (_provider === 'opwallet' || _provider === 'unisat') {
      return await _providerObj.signPsbt(psbtHex, options);
    }
    if (_provider === 'xverse') {
      const signed = await _providerObj.signPsbt({ psbt: psbtHex, ...options });
      return signed?.psbt;
    }
    throw new Error('signPsbt not supported for: ' + _provider);
  }

  // ——— Sign message ———
  async function signMessage(message) {
    if (!_provider || !_providerObj) throw new Error('Wallet not connected');
    if (_provider === 'opwallet' || _provider === 'unisat') {
      return await _providerObj.signMessage(message);
    }
    if (_provider === 'xverse') {
      const resp = await _providerObj.signMessage({ message, address: _address });
      return resp?.signature;
    }
    if (_provider === 'okx') {
      return await window.okxwallet.bitcoin.signMessage(message);
    }
    throw new Error('signMessage not supported');
  }

  // ——— Broadcast raw tx ———
  async function broadcastTx(txHex) {
    // Try wallet push first
    if ((_provider === 'opwallet' || _provider === 'unisat') && _providerObj?.pushTx) {
      try { return await _providerObj.pushTx({ rawtx: txHex }); } catch {}
    }
    // Fallback mempool.space
    const res = await fetch('https://mempool.space/testnet4/api/tx', {
      method: 'POST', body: txHex, headers: { 'Content-Type': 'text/plain' }
    });
    if (res.ok) return await res.text();
    throw new Error(await res.text());
  }

  // ——— Helpers ———
  function shortAddr(addr, n = 8) {
    if (!addr) return '—';
    return addr.slice(0, n) + '…' + addr.slice(-6);
  }

  // State accessors — support both API styles from OPILL codebase
  const state = new Proxy({}, {
    get(_, prop) {
      if (prop === 'connected')  return !!_address;
      if (prop === 'address')    return _address;
      if (prop === 'type')       return _provider;
      if (prop === 'balance')    return Math.round(_btcBalance * 1e8); // in sats
      if (prop === 'pubkey')     return _pubkey;
      return undefined;
    }
  });

  function isConnected()   { return !!_address; }
  function getAddress()    { return _address; }
  function getPubkey()     { return _pubkey; }
  function getProvider()   { return _provider; }
  function getBtcBalance() { return _btcBalance; }
  function onEvent(fn)     { LISTENERS.push(fn); }

  return {
    state,
    detectWallets, connect, disconnect, restoreSession,
    refreshBtcBalance, sendBitcoin, signPsbt, signMessage, broadcastTx,
    shortAddr, isConnected, getAddress, getPubkey, getProvider, getBtcBalance,
    onEvent
  };
})();

window.Wallet = Wallet;
