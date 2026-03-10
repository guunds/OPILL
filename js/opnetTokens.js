// opnetTokens.js — OPNet OP-20 Token Registry & Balance
// DIPERBAIKI: Pakai OPNet REST API yang benar, bukan EVM-style eth_call

const OPNetTokens = (() => {

  // ── Daftar token OP-20 di testnet4 ──────────────────────────────────────────
  const TOKEN_LIST = [
    {
      symbol:       'OPILL',
      name:         'OPILL Protocol Token',
      contract:     '0xe3e58e9615ac3e8a29a316c64b8c5930600941096377e227cc456bebb7daf3ee',
      decimals:     18,
      color:        '#00e5ff',
      icon:         '💊',
      isNative:     false,
      faucetAmount: '1000',
    },
    {
      symbol:       'PILL',
      name:         'PILL Token',
      contract:     '0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb',
      decimals:     18,
      color:        '#ff8c00',
      icon:         '💉',
      isNative:     false,
      faucetAmount: '100',
    },
    {
      symbol:       'MOTO',
      name:         'MOTO Token',
      contract:     '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd',
      decimals:     18,
      color:        '#f7931a',
      icon:         '🏍️',
      isNative:     false,
      faucetAmount: '500',
    }
  ];

  const POOL_LIST = [
    { pair: ['OPILL','PILL'], fee: '0.3%', tvlUsd: null, vol24hUsd: null, apr: null },
    { pair: ['OPILL','MOTO'], fee: '1%',   tvlUsd: null, vol24hUsd: null, apr: null },
    { pair: ['PILL','MOTO'],  fee: '0.3%', tvlUsd: null, vol24hUsd: null, apr: null },
  ];

  // Cache balance
  let _balances  = {};
  let _lastFetch = 0;

  // ── Getters ──────────────────────────────────────────────────────────────────
  function getTokenList()             { return [...TOKEN_LIST]; }
  function getToken(symbol)           { return TOKEN_LIST.find(t => t.symbol === symbol) || null; }
  function getTokenByContract(addr)   {
    if (!addr) return null;
    return TOKEN_LIST.find(t => t.contract.toLowerCase() === addr.toLowerCase()) || null;
  }
  function getPools()                 { return [...POOL_LIST]; }

  // ── Fetch balance satu token ─────────────────────────────────────────────────
  async function _fetchOneBalance(token, walletAddress) {
    const OPNET_RPC = 'https://testnet.opnet.org';

    // Metode 1: OP_NET REST API /api/v1/token/{contract}/balance/{address}
    try {
      const url = `${OPNET_RPC}/api/v1/token/${token.contract}/balance/${encodeURIComponent(walletAddress)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const d = await res.json();
        const raw = d?.balance ?? d?.result ?? d?.data;
        if (raw !== undefined && raw !== null) {
          return BigInt(String(raw));
        }
      }
    } catch (e) {
      console.warn(`[OPNetTokens] REST balance gagal untuk ${token.symbol}:`, e.message);
    }

    // Metode 2: eth_call dengan encode address sebagai byte string
    try {
      // OP_NET encode Bitcoin address sebagai bytes, lalu kita jadikan hex 32-byte
      const addrHex = OPNet.addressToBytes32(walletAddress);
      const data    = '0x70a08231' + addrHex; // balanceOf(address)
      const result  = await OPNet.rpc('eth_call', [{ to: token.contract, data }, 'latest']);
      if (result && result !== '0x' && result !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        return BigInt(result);
      }
    } catch (e) {
      console.warn(`[OPNetTokens] eth_call balance gagal untuk ${token.symbol}:`, e.message);
    }

    // Metode 3: /api/v1/contract/{contract}/call balanceOf
    try {
      const url = `${OPNET_RPC}/api/v1/contract/${token.contract}/call`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'balanceOf',
          params: [walletAddress]
        })
      });
      if (res.ok) {
        const d = await res.json();
        const raw = d?.result ?? d?.balance ?? d?.data;
        if (raw !== undefined) return BigInt(String(raw));
      }
    } catch {}

    return BigInt(0);
  }

  // ── Fetch semua balance ──────────────────────────────────────────────────────
  async function fetchAllBalances(walletAddress) {
    if (!walletAddress) { _balances = {}; return {}; }

    const results = {};
    await Promise.allSettled(
      TOKEN_LIST.map(async (token) => {
        try {
          const raw = await _fetchOneBalance(token, walletAddress);
          results[token.symbol] = OPNet.formatUnits(raw, token.decimals);
        } catch (e) {
          console.warn('[OPNetTokens] fetchBalance error:', token.symbol, e.message);
          results[token.symbol] = _balances[token.symbol] || '0'; // pertahankan cache
        }
      })
    );

    _balances  = results;
    _lastFetch = Date.now();
    return { ...results };
  }

  // ── Getters balance ──────────────────────────────────────────────────────────
  function getBalance(symbol)  { return _balances[symbol] || '0'; }
  function getAllBalances()     { return { ..._balances }; }

  function displayBalance(symbol, showSymbol = true) {
    const b = parseFloat(_balances[symbol] || '0');
    const fmt = b === 0
      ? '0'
      : b < 0.0001
        ? b.toExponential(2)
        : b.toLocaleString('en-US', { maximumFractionDigits: 6 });
    return showSymbol ? `${fmt} ${symbol}` : fmt;
  }

  // ── Estimasi swap (harga dummy — ganti dengan real AMM kalau ada pool) ────────
  function estimateSwap(fromSymbol, toSymbol, amountIn) {
    const amt = parseFloat(amountIn);
    if (!amt || isNaN(amt)) return { amountOut: '0', priceImpact: '0', route: [], fee: '0', minReceived: '0' };
    // Harga sementara (simulasi)
    const prices = { OPILL: 1.82, PILL: 0.50, MOTO: 0.25, tBTC: 60000, WBTC: 60000 };
    const fP = prices[fromSymbol] || 1;
    const tP = prices[toSymbol]   || 1;
    const raw    = (amt * fP / tP) * 0.997; // 0.3% fee
    const impact = Math.min(0.1 + amt * 0.001, 5).toFixed(2);
    return {
      amountOut:   raw.toFixed(6),
      priceImpact: impact,
      route:       [fromSymbol, toSymbol],
      fee:         (amt * 0.003).toFixed(6) + ' ' + fromSymbol,
      minReceived: (raw * 0.995).toFixed(6) + ' ' + toSymbol,
    };
  }

  return {
    getTokenList, getToken, getTokenByContract, getPools,
    fetchAllBalances, getBalance, getAllBalances, displayBalance,
    estimateSwap,
  };
})();

window.OPNetTokens = OPNetTokens;
