// opnetTokens.js — OPNet testnet token registry + balance fetching

const OPNetTokens = (() => {
  const TOKEN_LIST = [
    {
      symbol:       'OPILL',
      name:         'OPILL Protocol Token',
      contract:     '0xe3e58e9615ac3e8a29a316c64b8c5930600941096377e227cc456bebb7daf3ee',
      decimals:     8,
      color:        '#00e5ff',
      icon:         '💊',
      isNative:     false,
      faucetAmount: '1000'
    },
    {
      symbol:       'PILL',
      name:         'PILL Token',
      contract:     '0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb',
      decimals:     8,
      color:        '#ff8c00',
      icon:         '💉',
      isNative:     false,
      faucetAmount: '100'
    },
    {
      symbol:       'MOTO',
      name:         'MOTO Token',
      contract:     '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd',
      decimals:     8,
      color:        '#f7931a',
      icon:         '🏍️',
      isNative:     false,
      faucetAmount: '500'
    }
  ];

  const POOL_LIST = [
    { pair: ['OPILL','PILL'], fee: '0.3%', tvlUsd: null, vol24hUsd: null, apr: null },
    { pair: ['OPILL','MOTO'], fee: '1%',   tvlUsd: null, vol24hUsd: null, apr: null },
    { pair: ['PILL','MOTO'],  fee: '0.3%', tvlUsd: null, vol24hUsd: null, apr: null },
  ];

  let _balances = {};

  function getTokenList()         { return [...TOKEN_LIST]; }
  function getToken(symbol)       { return TOKEN_LIST.find(t => t.symbol === symbol) || null; }
  function getTokenByContract(a)  { return TOKEN_LIST.find(t => t.contract.toLowerCase() === a.toLowerCase()) || null; }
  function getPools()             { return [...POOL_LIST]; }

  // ——— Fetch balance for one token ———
  async function _fetchBalance(token, walletAddress) {
    try {
      const raw = await OPNet.getTokenBalance(token.contract, walletAddress);
      return OPNet.formatUnits(raw, token.decimals);
    } catch {
      return '0';
    }
  }

  // ——— Fetch all token balances ———
  async function fetchAllBalances(walletAddress) {
    if (!walletAddress) { _balances = {}; return {}; }
    const results = {};
    await Promise.allSettled(
      TOKEN_LIST.map(async (token) => {
        results[token.symbol] = await _fetchBalance(token, walletAddress);
      })
    );
    _balances = results;
    return { ...results };
  }

  function getBalance(symbol)  { return _balances[symbol] || '0'; }
  function getAllBalances()     { return { ..._balances }; }

  function displayBalance(symbol, showSymbol = true) {
    const b = parseFloat(_balances[symbol] || '0');
    const formatted = b === 0 ? '0'
      : b < 0.0001 ? b.toExponential(2)
      : b.toLocaleString('en-US', { maximumFractionDigits: 6 });
    return showSymbol ? `${formatted} ${symbol}` : formatted;
  }

  function estimateSwap(fromSymbol, toSymbol, amountIn) {
    const amt = parseFloat(amountIn);
    if (!amt || isNaN(amt)) return { amountOut: '0', priceImpact: '0', route: [] };
    const prices = { OPILL: 1.82, PILL: 0.5, MOTO: 0.25 };
    const fromPrice = prices[fromSymbol] || 1;
    const toPrice   = prices[toSymbol]   || 1;
    const raw       = (amt * fromPrice / toPrice) * 0.997;
    const impact    = Math.min(0.1 + amt * 0.001, 5).toFixed(2);
    return {
      amountOut:   raw.toFixed(6),
      priceImpact: impact,
      route:       [fromSymbol, toSymbol],
      fee:         (amt * 0.003).toFixed(6) + ' ' + fromSymbol,
      minReceived: (raw * 0.995).toFixed(6) + ' ' + toSymbol
    };
  }

  return {
    getTokenList, getToken, getTokenByContract, getPools,
    fetchAllBalances, getBalance, getAllBalances, displayBalance,
    estimateSwap
  };
})();

window.OPNetTokens = OPNetTokens;
