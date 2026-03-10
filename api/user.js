// api/user.js — User profile / preferences (stored in KV if available)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.method === 'GET' ? req.query : (req.body || {});
  if (!address) return res.status(400).json({ error: 'Missing address' });

  // In production: use Vercel KV (Redis) to store user prefs, claim history etc.
  // For now return empty profile
  return res.status(200).json({
    address,
    claimHistory: [],
    preferences: {}
  });
}
