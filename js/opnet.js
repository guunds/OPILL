// opnet.js — OPNet Bitcoin testnet integration
// Real JSON-RPC calls to testnet.opnet.org
// Supports balanceOf via Address encoding (OP_NET uses Bitcoin address as UTF-8 bytes)

const OPNet = (() => {
  const RPC_ENDPOINTS = [
    'https://testnet.opnet.org',
    'https://testnet4.opnet.org',
  ];
  let _activeRpc  = RPC_ENDPOINTS[0];
  let _latestBlock = 0;
  let _gasPrice    = 0;

  // ——— Low-level JSON-RPC with fallback ———
  async function rpc(method, params = []) {
    let lastError;
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        _activeRpc = endpoint;
        return data.result;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('All RPC endpoints failed');
  }

  // ——— REST GET with fallback ———
  async function rest(path) {
    let lastError;
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint + path);
        if (res.ok) { _activeRpc = endpoint; return await res.json(); }
      } catch(e) { lastError = e; }
    }
    throw lastError || new Error(`All endpoints failed for: ${path}`);
  }

  // ——— REST POST with fallback ———
  async function restPost(path, body) {
    let lastError;
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.ok) { _activeRpc = endpoint; return await res.json(); }
      } catch(e) { lastError = e; }
    }
    throw lastError || new Error(`REST POST failed for: ${path}`);
  }

  // ——— Block info ———
  async function getBlockNumber() {
    try {
      const r = await rpc('eth_blockNumber');
      _latestBlock = parseInt(r, 16);
      return _latestBlock;
    } catch {
      try {
        const d = await rest('/api/v1/block/latest');
        _latestBlock = d.height || d.blockNumber || d.block || 0;
        return _latestBlock;
      } catch { return _latestBlock; }
    }
  }

  async function getGasPrice() {
    try {
      const r = await rpc('eth_gasPrice');
      _gasPrice = parseInt(r, 16);
      return _gasPrice;
    } catch { return _gasPrice; }
  }

  // ——— eth_call (read-only contract call) ———
  async function call(contractAddress, data, blockTag = 'latest') {
    return rpc('eth_call', [{ to: contractAddress, data }, blockTag]);
  }

  // ——— OPNet Address Encoding ———
  // OPNet encodes Bitcoin addresses as UTF-8 bytes, NOT as Ethereum 20-byte hex.
  // The address string is encoded as bytes, right-padded to 32 bytes.
  function encodeAddressForCalldata(address) {
    const bytes = new TextEncoder().encode(address);
    const hex   = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.padEnd(64, '0'); // 32 bytes = 64 hex chars, right-padded with zeros
  }

  // ——— Get OP-20 token balance ———
  // OPNet balanceOf uses UTF-8 encoded address, not EVM-style padded address
  async function getTokenBalance(tokenContract, walletAddress) {
    // Method 1: OPNet native REST API
    try {
      const data = await rest(`/api/v1/token/${tokenContract}/balance/${walletAddress}`);
      if (data?.balance !== undefined) return BigInt(data.balance);
    } catch {}

    // Method 2: eth_call with UTF-8 encoded address (OPNet style)
    try {
      const encoded = encodeAddressForCalldata(walletAddress);
      const calldata = '0x70a08231' + encoded; // balanceOf(address)
      const result = await call(tokenContract, calldata);
      if (result && result !== '0x') return BigInt(result);
    } catch {}

    // Method 3: REST POST contract call
    try {
      const data = await restPost(`/api/v1/contract/${tokenContract}/call`, {
        method: 'balanceOf',
        params: [walletAddress]
      });
      if (data?.result !== undefined) return BigInt(data.result);
    } catch {}

    return BigInt(0);
  }

  // ——— Get token info ———
  async function getTokenInfo(tokenContract) {
    try {
      return await rest(`/api/v1/token/${tokenContract}`);
    } catch { return null; }
  }

  async function getDecimals(tokenContract) {
    try {
      const result = await call(tokenContract, '0x313ce567');
      return parseInt(result, 16) || 8;
    } catch { return 8; }
  }

  async function getSymbol(tokenContract) {
    try {
      const info = await getTokenInfo(tokenContract);
      if (info?.symbol) return info.symbol;
    } catch {}
    try {
      const result = await call(tokenContract, '0x95d89b41');
      return decodeABIString(result) || '???';
    } catch { return '???'; }
  }

  async function getName(tokenContract) {
    try {
      const info = await getTokenInfo(tokenContract);
      if (info?.name) return info.name;
    } catch {}
    try {
      const result = await call(tokenContract, '0x06fdde03');
      return decodeABIString(result) || '';
    } catch { return ''; }
  }

  // ——— Recent transactions ———
  async function getTransactions(address, limit = 50) {
    try {
      const d = await rest(`/api/v1/address/${address}/transactions?limit=${limit}`);
      return d?.transactions || d?.txs || d || [];
    } catch {
      try {
        const res = await fetch(`https://mempool.space/testnet4/api/address/${address}/txs`);
        const txs = await res.json();
        return txs.slice(0, limit);
      } catch { return []; }
    }
  }

  // ——— Decode ABI-encoded string ———
  function decodeABIString(hex) {
    try {
      const bytes = hex.replace('0x', '');
      if (bytes.length < 192) return '';
      const len    = parseInt(bytes.slice(128, 192), 16);
      const strHex = bytes.slice(192, 192 + len * 2);
      return strHex.match(/.{2}/g).map(b => String.fromCharCode(parseInt(b, 16))).join('').replace(/\0/g, '');
    } catch { return ''; }
  }

  // ——— Format token units ———
  function formatUnits(val, decimals = 8) {
    try {
      const v = typeof val === 'bigint' ? val : BigInt(String(val || '0'));
      if (v === 0n) return '0';
      const divisor = 10n ** BigInt(decimals);
      const int  = v / divisor;
      const frac = v % divisor;
      const fracStr = frac.toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
      return fracStr ? `${int}.${fracStr}` : `${int}`;
    } catch { return '0'; }
  }

  function encodeAmount(amount, decimals = 8) {
    const [intPart, fracPart = ''] = String(amount).split('.');
    const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(intPart) * (10n ** BigInt(decimals)) + BigInt(paddedFrac || 0);
  }

  return {
    rpc, rest, restPost, call,
    getBlockNumber, getGasPrice,
    getTokenBalance, getTokenInfo, getDecimals, getSymbol, getName,
    getTransactions, formatUnits, encodeAmount, decodeABIString,
    encodeAddressForCalldata,
    getCachedBlock: () => _latestBlock,
    getCachedGas:   () => _gasPrice,
    getActiveRpc:   () => _activeRpc
  };
})();

window.OPNet = OPNet;
