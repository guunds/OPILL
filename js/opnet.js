// opnet.js — OPNet Bitcoin testnet integration

const OPNet = (() => {
  const BACKEND     = 'https://shotten-bently-skulkingly.ngrok-free.app';
  const OPNET_RPCS  = ['http://127.0.0.1:9000', 'https://regtest.opnet.org'];
  const MEMPOOL     = ['https://mempool.space/testnet4', 'https://mempool.space/testnet'];
  let _latestBlock  = 0;
  let _activeRpc    = OPNET_RPCS[0];

  async function rpc(method, params = []) {
    try {
      const res = await fetch(`${BACKEND}/api/opnet/rpc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
      });
      const data = await res.json();
      if (data.result !== undefined) return data.result;
    } catch {}
    for (const ep of OPNET_RPCS) {
      try {
        const res = await fetch(ep, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
          signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        _activeRpc = ep; return data.result;
      } catch {}
    }
    throw new Error('OP_NET RPC tidak tersedia');
  }

  async function rest(path) {
    for (const ep of OPNET_RPCS) {
      try {
        const res = await fetch(ep + path, { signal: AbortSignal.timeout(5000) });
        if (res.ok) { _activeRpc = ep; return await res.json(); }
      } catch {}
    }
    throw new Error('OP_NET REST gagal: ' + path);
  }

  async function restPost(path, body) {
    for (const ep of OPNET_RPCS) {
      try {
        const res = await fetch(ep + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
        });
        if (res.ok) { _activeRpc = ep; return await res.json(); }
      } catch {}
    }
    throw new Error('OP_NET REST POST gagal: ' + path);
  }

  async function getBlockNumber() {
    for (const base of MEMPOOL) {
      try {
        const res = await fetch(`${base}/api/blocks/tip/height`);
        if (res.ok) { _latestBlock = parseInt(await res.text()); return _latestBlock; }
      } catch {}
    }
    try { const r = await rpc('eth_blockNumber'); _latestBlock = parseInt(r, 16); return _latestBlock; } catch {}
    return _latestBlock;
  }

  async function getGasPrice() {
    try {
      const res = await fetch(`${BACKEND}/api/fee`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (res.ok) { const d = await res.json(); return d.fastest || 10; }
    } catch {}
    return 10;
  }

  async function call(contractAddress, data, blockTag = 'latest') {
    return rpc('eth_call', [{ to: contractAddress, data }, blockTag]);
  }

  function encodeAddressForCalldata(address) {
    const bytes = new TextEncoder().encode(address);
    const hex   = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.padEnd(64, '0');
  }

  async function getBTCBalance(address) {
    try {
      const res = await fetch(`${BACKEND}/api/balance/${address}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (res.ok) { const d = await res.json(); if (d.success) return { sats: d.sats, btc: d.btc }; }
    } catch {}
    return { sats: 0, btc: '0' };
  }

  async function getTokenBalance(tokenContract, walletAddress) {
    try {
      const data = await rest(`/api/v1/token/${tokenContract}/balance/${walletAddress}`);
      if (data?.balance !== undefined) return BigInt(data.balance);
    } catch {}
    try {
      const result = await call(tokenContract, '0x70a08231' + encodeAddressForCalldata(walletAddress));
      if (result && result !== '0x') return BigInt(result);
    } catch {}
    return BigInt(0);
  }

  async function getTokenInfo(tokenContract) {
    try { return await rest(`/api/v1/token/${tokenContract}`); } catch { return null; }
  }

  async function getDecimals(tokenContract) {
    try { return parseInt(await call(tokenContract, '0x313ce567'), 16) || 8; } catch { return 8; }
  }

  async function getSymbol(tokenContract) {
    try { const i = await getTokenInfo(tokenContract); if (i?.symbol) return i.symbol; } catch {}
    try { return decodeABIString(await call(tokenContract, '0x95d89b41')) || '???'; } catch { return '???'; }
  }

  async function getName(tokenContract) {
    try { const i = await getTokenInfo(tokenContract); if (i?.name) return i.name; } catch {}
    try { return decodeABIString(await call(tokenContract, '0x06fdde03')) || ''; } catch { return ''; }
  }

  async function getTransactions(address, limit = 20) {
    try {
      const res = await fetch(`${BACKEND}/api/transactions/${address}?limit=${limit}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (res.ok) { const d = await res.json(); if (d.transactions) return d.transactions; }
    } catch {}
    return [];
  }

  function decodeABIString(hex) {
    try {
      const b = (hex || '').replace('0x', '');
      if (b.length < 192) return '';
      const len = parseInt(b.slice(128, 192), 16);
      return (b.slice(192, 192 + len * 2).match(/.{2}/g) || []).map(x => String.fromCharCode(parseInt(x, 16))).join('').replace(/\0/g, '');
    } catch { return ''; }
  }

  function formatUnits(val, decimals = 8) {
    try {
      const v = typeof val === 'bigint' ? val : BigInt(String(val || '0'));
      if (v === 0n) return '0';
      const d = 10n ** BigInt(decimals);
      const ip = v / d, fp = v % d;
      const fs = fp.toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
      return fs ? `${ip}.${fs}` : `${ip}`;
    } catch { return '0'; }
  }

  function encodeAmount(amount, decimals = 8) {
    const [ip, fp = ''] = String(amount).split('.');
    const pf = (fp + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(ip) * (10n ** BigInt(decimals)) + BigInt(pf || 0);
  }

  return {
    rpc, rest, restPost, call,
    getBlockNumber, getGasPrice, getBTCBalance,
    getTokenBalance, getTokenInfo, getDecimals, getSymbol, getName,
    getTransactions, formatUnits, encodeAmount,
    decodeABIString, encodeAddressForCalldata,
    getCachedBlock: () => _latestBlock,
    getActiveRpc:   () => _activeRpc,
  };
})();

window.OPNet = OPNet;
console.log('[OPNet] loaded — backend: https://shotten-bently-skulkingly.ngrok-free.app');