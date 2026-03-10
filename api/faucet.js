// api/faucet.js — Vercel Serverless Function
// POST { address, token } → sends testnet tokens to address

const FAUCET_CONFIG = {
  OPILL: { amount: '1000',  contractEnv: 'OPILL_CONTRACT' },
  WBTC:  { amount: '0.01',  contractEnv: 'WBTC_CONTRACT'  },
  USDT:  { amount: '500',   contractEnv: 'USDT_CONTRACT'  },
  USDC:  { amount: '500',   contractEnv: 'USDC_CONTRACT'  },
  ORDI:  { amount: '100',   contractEnv: 'ORDI_CONTRACT'  },
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Simple in-memory rate limiting (use Redis/KV in production)
const claimCache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { address, token } = req.body || {};
  if (!address || !token)  return res.status(400).json({ error: 'Missing address or token' });
  if (!FAUCET_CONFIG[token]) return res.status(400).json({ error: 'Unknown token: ' + token });

  // Rate limit check
  const key      = `${address}:${token}`;
  const lastClaim = claimCache.get(key) || 0;
  const remaining = COOLDOWN_MS - (Date.now() - lastClaim);
  if (remaining > 0) {
    return res.status(429).json({ error: `Cooldown: ${Math.ceil(remaining/3600000)}h remaining` });
  }

  try {
    const cfg = FAUCET_CONFIG[token];
    const OPNET_RPC    = process.env.OPNET_RPC    || 'https://testnet.opnet.org';
    const FAUCET_PK    = process.env.FAUCET_PRIVATE_KEY;

    if (!FAUCET_PK) {
      // Dev mode: return fake txid so the front-end flow works
      const fakeTxid = '0x' + Math.random().toString(16).slice(2).padEnd(64, '0');
      claimCache.set(key, Date.now());
      return res.status(200).json({ txid: fakeTxid, amount: cfg.amount, token });
    }

    // Production: build + broadcast ERC-20 transfer transaction via OPNet
    // This requires the faucet wallet to have tokens minted to it
    // Full implementation would use @btc-vision/transaction SDK
    const txid = await sendTokens({
      rpc: OPNET_RPC,
      privateKey: FAUCET_PK,
      tokenContract: process.env[cfg.contractEnv] || '',
      toAddress: address,
      amount: cfg.amount,
      decimals: token === 'WBTC' ? 8 : token === 'USDT' || token === 'USDC' ? 6 : 18
    });

    claimCache.set(key, Date.now());
    return res.status(200).json({ txid, amount: cfg.amount, token });
  } catch (err) {
    console.error('[faucet]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

async function sendTokens({ rpc, privateKey, tokenContract, toAddress, amount, decimals }) {
  // Stub — replace with @btc-vision/transaction SDK call
  // Example:
  //   const wallet = Wallet.fromPrivateKey(privateKey);
  //   const tx = await buildERC20Transfer(tokenContract, toAddress, amount, decimals);
  //   const signed = await wallet.sign(tx);
  //   return await broadcast(rpc, signed);
  throw new Error('Production faucet not configured — set FAUCET_PRIVATE_KEY env var');
}
