// api/transactions.js — Proxy OPNet/mempool transactions for a wallet address
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, limit = 50 } = req.query;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    // Try OPNet first
    const opnetUrl = `${process.env.OPNET_RPC || 'https://testnet.opnet.org'}/api/v1/address/${address}/transactions?limit=${limit}`;
    const r = await fetch(opnetUrl);
    if (r.ok) {
      const d = await r.json();
      return res.status(200).json(d);
    }
  } catch {}

  try {
    // Fallback: mempool.space testnet
    const r = await fetch(`https://mempool.space/testnet/api/address/${address}/txs`);
    const txs = await r.json();
    return res.status(200).json({ transactions: txs.slice(0, parseInt(limit)) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
