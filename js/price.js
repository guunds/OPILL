// price.js — BTC price feed via CoinGecko + fallback

const Price = (() => {
  let _btcUsd     = 0;
  let _lastFetch  = 0;
  let _listeners  = [];
  const CACHE_TTL = 60_000; // 1 min

  async function fetchBtcPrice() {
    if (Date.now() - _lastFetch < CACHE_TTL) return _btcUsd;
    try {
      // CoinGecko free API (no key needed)
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'
      );
      const data = await res.json();
      _btcUsd   = data?.bitcoin?.usd || _btcUsd;
      _lastFetch = Date.now();
      _listeners.forEach(fn => { try { fn(_btcUsd); } catch {} });
      return _btcUsd;
    } catch {
      // Fallback: Binance public API
      try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const d = await r.json();
        _btcUsd = parseFloat(d.price) || _btcUsd;
        _lastFetch = Date.now();
        _listeners.forEach(fn => { try { fn(_btcUsd); } catch {} });
        return _btcUsd;
      } catch {
        return _btcUsd;
      }
    }
  }

  function getCached()   { return _btcUsd; }
  function onUpdate(fn)  { _listeners.push(fn); }

  function formatUsd(btcAmt) {
    const usd = parseFloat(btcAmt) * _btcUsd;
    if (!usd) return '$0.00';
    return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }

  // Auto-refresh every 60s
  function startPolling() {
    fetchBtcPrice();
    setInterval(fetchBtcPrice, CACHE_TTL);
  }

  return { fetchBtcPrice, getCached, onUpdate, formatUsd, startPolling };
})();

window.Price = Price;
