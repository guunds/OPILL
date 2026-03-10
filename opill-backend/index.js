// opill-backend/index.js
// Backend proxy server untuk OPiLL Protocol
// Menghubungkan frontend ke Bitcoin Core (lokal) + mempool.space (fallback)

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── KONFIGURASI ──────────────────────────────────────────────────
const BTC_RPC = {
  host: process.env.BTC_RPC_HOST || '127.0.0.1',
  port: process.env.BTC_RPC_PORT || 18332,
  user: process.env.BTC_RPC_USER || 'bitcoin',
  pass: process.env.BTC_RPC_PASS || 'bitcoin',
};
const MEMPOOL_TESTNET = 'https://mempool.space/testnet4';
const MEMPOOL_TESTNET3 = 'https://mempool.space/testnet';

// ── Bitcoin Core RPC helper ──────────────────────────────────────
async function btcRpc(method, params = []) {
  const url  = `http://${BTC_RPC.host}:${BTC_RPC.port}`;
  const auth = Buffer.from(`${BTC_RPC.user}:${BTC_RPC.pass}`).toString('base64');
  const res  = await axios.post(url, {
    jsonrpc: '1.0', id: 'opill', method, params
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    timeout: 10000
  });
  if (res.data.error) throw new Error(res.data.error.message);
  return res.data.result;
}

// ── Mempool helper (dengan fallback testnet3 → testnet4) ─────────
async function mempoolGet(path) {
  for (const base of [MEMPOOL_TESTNET, MEMPOOL_TESTNET3]) {
    try {
      const res = await axios.get(base + path, { timeout: 8000 });
      return res.data;
    } catch {}
  }
  throw new Error('Mempool API tidak respond');
}

// ── OP_NET node helper (port 9000 lokal) ─────────────────────────
async function opnetGet(path) {
  try {
    const res = await axios.get(`http://127.0.0.1:9000${path}`, { timeout: 8000 });
    return res.data;
  } catch (err) {
    throw new Error('OP_NET node: ' + err.message);
  }
}

async function opnetRpc(method, params = []) {
  try {
    const res = await axios.post('http://127.0.0.1:9000', {
      jsonrpc: '2.0', id: Date.now(), method, params
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });
    if (res.data.error) throw new Error(res.data.error.message);
    return res.data.result;
  } catch (err) {
    throw new Error('OP_NET RPC: ' + err.message);
  }
}

// ── Deteksi tipe address ──────────────────────────────────────────
function isOpnetAddress(addr) {
  return addr && (addr.startsWith('opt1') || addr.startsWith('bc1op'));
}

// ── Balance universal (support opt1p + tb1p) ─────────────────────
async function getBalanceUniversal(address) {
  // opt1p... → pakai OP_NET node lokal
  if (isOpnetAddress(address)) {
    // Coba OP_NET REST API
    const endpoints = [
      `/api/v1/address/${address}`,
      `/api/v1/balance/${address}`,
      `/api/v1/states/address/${address}`,
    ];
    for (const path of endpoints) {
      try {
        const data = await opnetGet(path);
        // Cari field balance dari berbagai format response
        const sats =
          data.balance ??
          data.satoshis ??
          data.btcBalance ??
          data.data?.balance ??
          data.result?.balance ??
          null;
        if (sats !== null && sats !== undefined) {
          return { sats: Number(sats), btc: (Number(sats) / 1e8).toFixed(8), source: 'opnet-local' };
        }
        // Kalau ada field lain yang mungkin balance
        if (data.confirmed !== undefined) {
          return { sats: data.confirmed, btc: (data.confirmed / 1e8).toFixed(8), source: 'opnet-local' };
        }
      } catch {}
    }

    // Fallback: coba RPC eth_getBalance
    try {
      const result = await opnetRpc('eth_getBalance', [address, 'latest']);
      const sats = parseInt(result, 16);
      if (!isNaN(sats)) {
        return { sats, btc: (sats / 1e8).toFixed(8), source: 'opnet-rpc' };
      }
    } catch {}

    return { sats: 0, btc: '0.00000000', source: 'opnet-unavailable', note: 'OP_NET node masih indexing' };
  }

  // tb1p / tb1q → pakai mempool.space
  for (const base of [MEMPOOL_TESTNET, MEMPOOL_TESTNET3]) {
    try {
      const res  = await axios.get(`${base}/api/address/${address}`, { timeout: 8000 });
      const d    = res.data;
      const sats = (d.chain_stats.funded_txo_sum || 0) - (d.chain_stats.spent_txo_sum || 0);
      return { sats, btc: (sats / 1e8).toFixed(8), source: 'mempool.space' };
    } catch {}
  }

  throw new Error('Tidak bisa ambil balance untuk address ini');
}

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/health
// ════════════════════════════════════════════════════════════════
app.get('/api/health', async (req, res) => {
  let btcOk = false, btcBlocks = 0, btcProgress = 0;
  try {
    const info = await btcRpc('getblockchaininfo');
    btcOk      = true;
    btcBlocks  = info.blocks;
    btcProgress = Math.round(info.verificationprogress * 100 * 10) / 10;
  } catch {}

  res.json({
    status: 'ok',
    bitcoin_core: { connected: btcOk, blocks: btcBlocks, sync_progress: btcProgress + '%' },
    timestamp: new Date().toISOString()
  });
});

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/balance/:address
// Support opt1p... (OP_NET) dan tb1p/tb1q (Bitcoin testnet)
// ════════════════════════════════════════════════════════════════
app.get('/api/balance/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const result = await getBalanceUniversal(address);
    res.json({ success: true, address, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/utxos/:address
// Ambil UTXOs untuk address (dibutuhkan untuk kirim TX)
// ════════════════════════════════════════════════════════════════
app.get('/api/utxos/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const utxos = await mempoolGet(`/api/address/${address}/utxo`);
    res.json({ success: true, address, utxos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/fee
// Ambil fee rate dari mempool
// ════════════════════════════════════════════════════════════════
app.get('/api/fee', async (req, res) => {
  try {
    const fees = await mempoolGet('/api/v1/fees/recommended');
    res.json({
      success: true,
      fastest:  fees.fastestFee,
      halfHour: fees.halfHourFee,
      hour:     fees.hourFee,
      economy:  fees.economyFee,
      minimum:  fees.minimumFee,
    });
  } catch (err) {
    // Fallback ke Bitcoin Core
    try {
      const result = await btcRpc('estimatesmartfee', [1]);
      const feeRate = Math.ceil((result.feerate || 0.0001) * 1e8 / 1000);
      res.json({ success: true, fastest: feeRate, halfHour: feeRate, hour: feeRate });
    } catch {
      res.json({ success: true, fastest: 10, halfHour: 5, hour: 3 }); // default fallback
    }
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/transactions/:address
// Ambil riwayat transaksi
// ════════════════════════════════════════════════════════════════
app.get('/api/transactions/:address', async (req, res) => {
  const { address } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  try {
    const txs = await mempoolGet(`/api/address/${address}/txs`);
    res.json({ success: true, transactions: txs.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: POST /api/broadcast
// Broadcast raw transaction ke Bitcoin testnet
// Body: { hex: "raw_tx_hex" }
// ════════════════════════════════════════════════════════════════
app.post('/api/broadcast', async (req, res) => {
  const { hex } = req.body;
  if (!hex) return res.status(400).json({ success: false, error: 'Missing hex' });

  // Coba broadcast via mempool.space dulu (lebih reliable)
  try {
    const response = await axios.post(
      `${MEMPOOL_TESTNET}/api/tx`,
      hex,
      { headers: { 'Content-Type': 'text/plain' }, timeout: 15000 }
    );
    const txid = response.data;
    console.log(`[BROADCAST] ✓ via mempool.space: ${txid}`);
    return res.json({
      success: true,
      txid,
      explorerUrl: `${MEMPOOL_TESTNET}/tx/${txid}`
    });
  } catch (err1) {
    console.log(`[BROADCAST] mempool.space failed: ${err1.message}`);
  }

  // Fallback: broadcast via Bitcoin Core
  try {
    const txid = await btcRpc('sendrawtransaction', [hex]);
    console.log(`[BROADCAST] ✓ via Bitcoin Core: ${txid}`);
    return res.json({
      success: true,
      txid,
      explorerUrl: `${MEMPOOL_TESTNET}/tx/${txid}`
    });
  } catch (err2) {
    console.error(`[BROADCAST] ✗ Both failed: ${err2.message}`);
    return res.status(500).json({ success: false, error: err2.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: GET /api/tx/:txid
// Cek status transaksi
// ════════════════════════════════════════════════════════════════
app.get('/api/tx/:txid', async (req, res) => {
  const { txid } = req.params;
  try {
    const tx = await mempoolGet(`/api/tx/${txid}`);
    res.json({
      success: true,
      txid,
      confirmed: tx.status?.confirmed || false,
      blockHeight: tx.status?.block_height || null,
      explorerUrl: `${MEMPOOL_TESTNET}/tx/${txid}`
    });
  } catch (err) {
    res.status(404).json({ success: false, error: 'TX not found' });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTE: POST /api/opnet/rpc
// Proxy ke OP_NET node lokal (port 9000)
// Fallback ke public endpoint jika lokal tidak tersedia
// ════════════════════════════════════════════════════════════════
app.post('/api/opnet/rpc', async (req, res) => {
  const OPNET_ENDPOINTS = [
    'http://127.0.0.1:9000',       // Node lokal kamu
    'https://regtest.opnet.org',   // Public fallback
  ];

  for (const endpoint of OPNET_ENDPOINTS) {
    try {
      const response = await axios.post(endpoint, req.body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000
      });
      return res.json(response.data);
    } catch {}
  }

  res.status(503).json({
    error: 'OP_NET node tidak tersedia',
    detail: 'Node lokal belum sync, gunakan wallet extension untuk TX OP-20'
  });
});

// ── START ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║     OPiLL Protocol Backend v1.0           ║
╠═══════════════════════════════════════════╣
║  http://localhost:${PORT}                    ║
╠═══════════════════════════════════════════╣
║  GET  /api/health                         ║
║  GET  /api/balance/:address               ║
║  GET  /api/utxos/:address                 ║
║  GET  /api/fee                            ║
║  GET  /api/transactions/:address          ║
║  POST /api/broadcast  { hex }             ║
║  GET  /api/tx/:txid                       ║
║  POST /api/opnet/rpc  (proxy)             ║
╚═══════════════════════════════════════════╝
  `);
});
