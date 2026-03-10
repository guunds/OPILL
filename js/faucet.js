// faucet.js — Testnet token faucet logic

const Faucet = (() => {
  const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per token
  const FAUCET_API  = '/api/faucet';

  // Claim tokens for a given symbol to the connected wallet
  async function claim(tokenSymbol) {
    if (!Wallet.isConnected()) throw new Error('Connect your wallet first');

    const cooldown = Storage.getFaucetCooldown(tokenSymbol, COOLDOWN_MS);
    if (cooldown > 0) throw new Error(`Cooldown: ${formatCooldown(cooldown)} remaining`);

    const address = Wallet.getAddress();
    // Call the Vercel serverless API
    const res = await fetch(FAUCET_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, token: tokenSymbol })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Faucet request failed');

    Storage.setFaucetClaim(tokenSymbol);

    const txid = data.txid || data.txHash || data.hash || null;
    if (txid) {
      Storage.addLocalTx({
        hash: txid,
        type: 'faucet',
        token: tokenSymbol,
        amount: data.amount || OPNetTokens.getToken(tokenSymbol)?.faucetAmount || '?',
        address,
        timestamp: Date.now(),
        status: 'pending'
      });
    }

    return { txid, amount: data.amount, token: tokenSymbol };
  }

  function getCooldownRemaining(tokenSymbol) {
    return Storage.getFaucetCooldown(tokenSymbol, COOLDOWN_MS);
  }

  function formatCooldown(ms) {
    if (ms <= 0) return 'Ready';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    const s = Math.floor((ms % 60_000) / 1000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function getCooldownPct(tokenSymbol) {
    const remaining = getCooldownRemaining(tokenSymbol);
    if (remaining <= 0) return 100;
    return Math.round(100 * (1 - remaining / COOLDOWN_MS));
  }

  return { claim, getCooldownRemaining, formatCooldown, getCooldownPct };
})();

window.Faucet = Faucet;
