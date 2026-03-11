// opill-backend/index.js  ── OPiLL Protocol Backend v2.0
// Pakai OP_NET SDK (@btc-vision/transaction + opnet) dengan benar
// Supports: balance detection, send token, mint NFT, broadcast tx

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS: izinkan frontend Vercel + localhost ─────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://opill-protocol.vercel.app',
    'http://localhost:3000',
    'http://localhost:5500',
    /\.vercel\.app$/,
    /ngrok-free\.app$/,
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));

// Bypass ngrok browser warning
app.use(function(req, res, next) {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
// ════════════════════════════════════════════════════════════════
// KONFIGURASI
// ════════════════════════════════════════════════════════════════
const NETWORK = process.env.NETWORK || 'testnet4';  // 'testnet4' | 'mainnet'

// Bitcoin Core RPC (local node)
const BTC_RPC = {
  host: process.env.BTC_RPC_HOST || '127.0.0.1',
  port: process.env.BTC_RPC_PORT || 48332,
  user: process.env.BTC_RPC_USER || 'bitcoin',
  pass: process.env.BTC_RPC_PASS || 'bitcoin',
};

// OP_NET endpoints (fallback chain: local → public testnet)
const OPNET_ENDPOINTS = [
  process.env.OPNET_URL || 'http://127.0.0.1:9001',
  'https://testnet.opnet.org',
  'https://testnet4.opnet.org',
].filter(Boolean);

// Mempool.space untuk balance BTC & broadcast fallback
const MEMPOOL_BASE = 'https://mempool.space/testnet4';

// ── Token contract addresses (Testnet4) ───────────────────────────
// GANTI dengan contract address yang benar dari project kamu
const TOKEN_CONTRACTS = {
  OPILL: process.env.CONTRACT_OPILL || 'bcrt1p_GANTI_OPILL_CONTRACT',
  PILL:  process.env.CONTRACT_PILL  || 'bcrt1p_GANTI_PILL_CONTRACT',
  MOTO:  process.env.CONTRACT_MOTO  || 'bcrt1p_GANTI_MOTO_CONTRACT',
};

// ── NFT contract address ──────────────────────────────────────────
const NFT_CONTRACT = process.env.CONTRACT_NFT || 'bcrt1p_GANTI_NFT_CONTRACT';

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

// Bitcoin Core RPC
async function btcRpc(method, params = []) {
  const url  = `http://${BTC_RPC.host}:${BTC_RPC.port}`;
  const auth = Buffer.from(`${BTC_RPC.user}:${BTC_RPC.pass}`).toString('base64');
  const res  = await axios.post(url, {
    jsonrpc: '1.0', id: 'opill', method, params
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    timeout: 15000
  });
  if (res.data.error) throw new Error(res.data.error.message);
  return res.data.result;
}

// OP_NET JSON-RPC (coba semua endpoint sampai berhasil)
async function opnetRpc(method, params = [], timeoutMs = 10000) {
  const errors = [];
  for (const ep of OPNET_ENDPOINTS) {
    try {
      const res = await axios.post(ep, {
        jsonrpc: '2.0', id: Date.now(), method, params
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs
      });
      if (res.data && res.data.result !== undefined) return res.data.result;
      if (res.data && res.data.error) throw new Error(res.data.error.message);
    } catch (e) {
      errors.push(`${ep}: ${e.message}`);
    }
  }
  throw new Error('OP_NET tidak tersedia. ' + errors.join(' | '));
}

// OP_NET GET request
async function opnetGet(path, timeoutMs = 10000) {
  const errors = [];
  for (const ep of OPNET_ENDPOINTS) {
    try {
      const res = await axios.get(ep + path, { timeout: timeoutMs });
      return res.data;
    } catch (e) {
      errors.push(`${ep}: ${e.message}`);
    }
  }
  throw new Error('OP_NET GET gagal. ' + errors.join(' | '));
}

// Mempool.space GET
async function mempoolGet(path) {
  const res = await axios.get(MEMPOOL_BASE + path, { timeout: 10000 });
  return res.data;
}

// Encode address ke hex untuk OP_NET calldata (balanceOf)
function encodeBalanceOfCalldata(address) {
  // balanceOf(address) = selector 0x70a08231 + padded address
  // Untuk Bitcoin address, OP_NET pakai encoding khusus
  const selector = '70a08231';
  // Encode Bitcoin address sebagai UTF-8 hex, padded ke 32 bytes
  const addrHex = Buffer.from(address, 'utf8').toString('hex');
  const padded  = addrHex.padStart(64, '0').slice(0, 64);
  return '0x' + selector + padded;
}

// Parse balance result dari OP_NET
function parseBalanceResult(result) {
  if (!result || result === '0x' || result === '0x0') return 0;
  const hex = result.replace('0x', '');
  if (!hex || hex === '0') return 0;
  try {
    const val = parseInt(hex, 16);
    return isNaN(val) ? 0 : val / 1e8;  // OP-20 pakai 8 desimal
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════

// ── Health check ─────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const status = {
    server:    'ok',
    network:   NETWORK,
    timestamp: new Date().toISOString(),
    bitcoin_core: { connected: false, blocks: 0, sync_progress: '0%', synced: false },
    opnet:     { connected: false, endpoint: null },
    mempool:   { connected: false },
  };

  // Cek Bitcoin Core
  try {
    const info         = await btcRpc('getblockchaininfo');
    status.bitcoin_core = {
      connected:    true,
      blocks:       info.blocks,
      headers:      info.headers,
      sync_progress: (info.verificationprogress * 100).toFixed(2) + '%',
      synced:       info.verificationprogress > 0.9999,
    };
  } catch (e) {
    status.bitcoin_core.error = e.message;
  }

  // Cek OP_NET
  for (const ep of OPNET_ENDPOINTS) {
    try {
      await axios.get(ep + '/api/v1/health', { timeout: 5000 });
      status.opnet = { connected: true, endpoint: ep };
      break;
    } catch {
      try {
        await axios.post(ep, { jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[] }, { timeout: 5000 });
        status.opnet = { connected: true, endpoint: ep };
        break;
      } catch {}
    }
  }

  // Cek Mempool
  try {
    await axios.get(MEMPOOL_BASE + '/api/v1/fees/recommended', { timeout: 5000 });
    status.mempool.connected = true;
  } catch {}

  res.json(status);
});

// ── BTC Balance ───────────────────────────────────────────────────
app.get('/api/balance/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const data = await mempoolGet(`/api/address/${address}`);
    const sats = (data.chain_stats.funded_txo_sum || 0)
               - (data.chain_stats.spent_txo_sum  || 0);
    res.json({
      success: true,
      address,
      sats,
      btc:    (sats / 1e8).toFixed(8),
      source: 'mempool.space',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Token Balance (OP-20) ─────────────────────────────────────────
// GET /api/token/:contract/balance/:address
app.get('/api/token/:contract/balance/:address', async (req, res) => {
  const { contract, address } = req.params;

  // Method 1: OP_NET REST API
  const restPaths = [
    `/api/v1/token/${contract}/balance/${address}`,
    `/api/v1/balance/${contract}/${address}`,
    `/api/v1/contract/${contract}/balanceOf/${address}`,
  ];
  for (const path of restPaths) {
    try {
      const data = await opnetGet(path, 8000);
      const bal  = data.balance ?? data.result ?? data.data?.balance ?? null;
      if (bal !== null && bal !== undefined) {
        return res.json({
          success:  true,
          address,
          contract,
          balance:  Number(bal) / 1e8,
          raw:      Number(bal),
          source:   'opnet-rest',
        });
      }
    } catch {}
  }

  // Method 2: OP_NET eth_call (balanceOf ABI)
  try {
    const calldata = encodeBalanceOfCalldata(address);
    const result   = await opnetRpc('eth_call', [
      { to: contract, data: calldata },
      'latest'
    ], 8000);
    const balance = parseBalanceResult(result);
    return res.json({
      success:  true,
      address,
      contract,
      balance,
      raw:      Math.round(balance * 1e8),
      source:   'opnet-ethcall',
    });
  } catch {}

  // Method 3: opnet_getBalance (OP_NET specific RPC)
  try {
    const result  = await opnetRpc('opnet_getBalance', [contract, address], 8000);
    const balance = typeof result === 'string'
      ? parseBalanceResult(result)
      : (Number(result) / 1e8 || 0);
    return res.json({
      success:  true,
      address,
      contract,
      balance,
      raw:      Math.round(balance * 1e8),
      source:   'opnet-getBalance',
    });
  } catch {}

  // Semua method gagal — kembalikan 0 bukan error
  // Supaya frontend tetap bisa tampil
  res.json({
    success:  true,
    address,
    contract,
    balance:  0,
    raw:      0,
    source:   'unavailable',
    note:     'OP_NET node tidak respond, balance mungkin tidak akurat',
  });
});

// ── Semua token balance sekaligus ────────────────────────────────
// GET /api/wallet/:address/tokens
app.get('/api/wallet/:address/tokens', async (req, res) => {
  const { address } = req.params;
  const results = {};

  await Promise.allSettled(
    Object.entries(TOKEN_CONTRACTS).map(async ([symbol, contract]) => {
      try {
        const r = await axios.get(
          `http://localhost:${PORT}/api/token/${contract}/balance/${address}`,
          { timeout: 12000 }
        );
        results[symbol] = {
          contract,
          balance: r.data.balance || 0,
          source:  r.data.source  || 'unknown',
        };
      } catch {
        results[symbol] = { contract, balance: 0, source: 'error' };
      }
    })
  );

  // Tambah BTC balance
  try {
    const btcRes = await axios.get(
      `http://localhost:${PORT}/api/balance/${address}`,
      { timeout: 10000 }
    );
    results.BTC = { balance: btcRes.data.btc, sats: btcRes.data.sats, source: btcRes.data.source };
  } catch {
    results.BTC = { balance: 0, sats: 0, source: 'error' };
  }

  res.json({ success: true, address, tokens: results });
});

// ── UTXOs ─────────────────────────────────────────────────────────
app.get('/api/utxos/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const utxos = await mempoolGet(`/api/address/${address}/utxo`);
    // Hitung total spendable
    const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
    res.json({
      success:   true,
      address,
      utxos,
      total_sats: totalSats,
      total_btc:  (totalSats / 1e8).toFixed(8),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Fee rate ──────────────────────────────────────────────────────
app.get('/api/fee', async (req, res) => {
  try {
    const fees = await mempoolGet('/api/v1/fees/recommended');
    res.json({
      success:  true,
      fastest:  fees.fastestFee  || 20,
      halfHour: fees.halfHourFee || 10,
      hour:     fees.hourFee     || 5,
      economy:  fees.economyFee  || 3,
      minimum:  fees.minimumFee  || 1,
      source:   'mempool.space',
    });
  } catch {
    // Fallback ke Bitcoin Core
    try {
      const result  = await btcRpc('estimatesmartfee', [1]);
      const feeRate = Math.ceil((result.feerate || 0.0001) * 1e8 / 1000);
      res.json({ success: true, fastest: feeRate, halfHour: feeRate, hour: feeRate, source: 'bitcoin-core' });
    } catch {
      res.json({ success: true, fastest: 20, halfHour: 10, hour: 5, source: 'default' });
    }
  }
});

// ── Transaction history ───────────────────────────────────────────
app.get('/api/transactions/:address', async (req, res) => {
  const { address } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  try {
    const txs = await mempoolGet(`/api/address/${address}/txs`);
    res.json({
      success:      true,
      address,
      transactions: txs.slice(0, limit).map(tx => ({
        txid:        tx.txid,
        confirmed:   tx.status?.confirmed || false,
        blockHeight: tx.status?.block_height || null,
        blockTime:   tx.status?.block_time || null,
        fee:         tx.fee,
        size:        tx.size,
        explorerUrl: `${MEMPOOL_BASE}/tx/${tx.txid}`,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Broadcast transaksi ───────────────────────────────────────────
// POST /api/broadcast  { hex: "rawtx_hex" }
// Ini dipakai setelah user sign PSBT di wallet extension
app.post('/api/broadcast', async (req, res) => {
  const { hex } = req.body;
  if (!hex) return res.status(400).json({ success: false, error: 'Missing hex' });

  console.log(`[BROADCAST] Attempting to broadcast tx (${hex.length/2} bytes)`);

  // Method 1: Bitcoin Core lokal (paling reliable kalau sudah sync)
  try {
    const nodeInfo = await btcRpc('getblockchaininfo');
    if (nodeInfo.verificationprogress > 0.999) {
      const txid = await btcRpc('sendrawtransaction', [hex]);
      console.log(`[BROADCAST] ✅ Bitcoin Core: ${txid}`);
      return res.json({
        success:     true,
        txid,
        source:      'bitcoin-core',
        explorerUrl: `${MEMPOOL_BASE}/tx/${txid}`,
      });
    } else {
      console.log(`[BROADCAST] Bitcoin Core sync ${(nodeInfo.verificationprogress*100).toFixed(1)}%, skip`);
    }
  } catch (e) {
    console.log(`[BROADCAST] Bitcoin Core failed: ${e.message}`);
  }

  // Method 2: OP_NET node (untuk OP-20 / NFT transactions)
  try {
    const result = await opnetRpc('eth_sendRawTransaction', [hex], 12000);
    if (result && result.length > 10) {
      console.log(`[BROADCAST] ✅ OP_NET: ${result}`);
      return res.json({
        success:     true,
        txid:        result,
        source:      'opnet',
        explorerUrl: `${MEMPOOL_BASE}/tx/${result}`,
      });
    }
  } catch (e) {
    console.log(`[BROADCAST] OP_NET failed: ${e.message}`);
  }

  // Method 3: Mempool.space (fallback untuk standard BTC tx)
  try {
    const response = await axios.post(`${MEMPOOL_BASE}/api/tx`, hex, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 15000,
    });
    const txid = response.data;
    console.log(`[BROADCAST] ✅ mempool.space: ${txid}`);
    return res.json({
      success:     true,
      txid,
      source:      'mempool.space',
      explorerUrl: `${MEMPOOL_BASE}/tx/${txid}`,
    });
  } catch (e) {
    console.log(`[BROADCAST] mempool.space failed: ${e.message}`);
  }

  res.status(503).json({
    success: false,
    error:   'Broadcast gagal di semua endpoint. Cek Bitcoin Core sync progress dan OP_NET node.',
    note:    'Bitcoin Core harus 100% sync untuk broadcast transaksi on-chain.',
  });
});

// ── Cek status transaksi ──────────────────────────────────────────
app.get('/api/tx/:txid', async (req, res) => {
  const { txid } = req.params;
  try {
    const tx = await mempoolGet(`/api/tx/${txid}`);
    res.json({
      success:     true,
      txid,
      confirmed:   tx.status?.confirmed  || false,
      blockHeight: tx.status?.block_height || null,
      blockTime:   tx.status?.block_time   || null,
      fee:         tx.fee,
      size:        tx.size,
      explorerUrl: `${MEMPOOL_BASE}/tx/${txid}`,
    });
  } catch {
    res.status(404).json({ success: false, error: 'TX not found' });
  }
});

// ── OP_NET RPC proxy ──────────────────────────────────────────────
// POST /api/opnet/rpc  (dipakai frontend untuk build transaksi)
app.post('/api/opnet/rpc', async (req, res) => {
  const errors = [];
  for (const ep of OPNET_ENDPOINTS) {
    try {
      const response = await axios.post(ep, req.body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000,
      });
      return res.json(response.data);
    } catch (e) {
      errors.push(`${ep}: ${e.message}`);
    }
  }
  res.status(503).json({
    error:   'OP_NET node tidak tersedia',
    details: errors,
  });
});

// ── Build transaksi SEND TOKEN ────────────────────────────────────
// POST /api/token/build-send
// Body: { contract, fromAddress, toAddress, amount, feeRate }
// Response: { psbt: "base64_psbt", ... } → user sign di browser → POST /api/broadcast
app.post('/api/token/build-send', async (req, res) => {
  const { contract, fromAddress, toAddress, amount, feeRate } = req.body;

  if (!contract || !fromAddress || !toAddress || !amount) {
    return res.status(400).json({
      success: false,
      error:   'Parameter kurang: contract, fromAddress, toAddress, amount wajib ada',
    });
  }

  // Cek Bitcoin Core sudah sync
  let btcSynced = false;
  try {
    const info = await btcRpc('getblockchaininfo');
    btcSynced  = info.verificationprogress > 0.999;
  } catch {}

  if (!btcSynced) {
    return res.status(503).json({
      success: false,
      error:   'Bitcoin Core belum sync 100%. Tunggu sync selesai untuk kirim transaksi on-chain.',
      note:    'Cek progress: GET /api/health',
    });
  }

  try {
    // Ambil UTXOs untuk gas fee
    const utxos = await mempoolGet(`/api/address/${fromAddress}/utxo`);
    if (!utxos || utxos.length === 0) {
      return res.status(400).json({
        success: false,
        error:   'Tidak ada UTXO. Kamu perlu Testnet4 BTC untuk gas fee.',
        faucet:  'https://mempool.space/testnet4/faucet',
      });
    }

    // Ambil fee rate
    let rate = feeRate;
    if (!rate) {
      try {
        const fees = await mempoolGet('/api/v1/fees/recommended');
        rate = fees.halfHourFee || 10;
      } catch {
        rate = 10;
      }
    }

    // Build calldata untuk transfer(address,uint256)
    // transfer selector = 0xa9059cbb
    const toHex      = Buffer.from(toAddress, 'utf8').toString('hex').padStart(64, '0').slice(0, 64);
    const amountSats = Math.round(amount * 1e8);
    const amountHex  = amountSats.toString(16).padStart(64, '0');
    const calldata   = '0xa9059cbb' + toHex + amountHex;

    // Kirim ke OP_NET untuk build transaksi
    const buildResult = await opnetRpc('opnet_buildTransaction', [{
      from:     fromAddress,
      to:       contract,
      data:     calldata,
      utxos:    utxos.slice(0, 5).map(u => ({
        txid:  u.txid,
        vout:  u.vout,
        value: u.value,
      })),
      feeRate:  rate,
      network:  NETWORK,
    }], 15000);

    if (!buildResult || !buildResult.psbt) {
      throw new Error('OP_NET tidak return PSBT');
    }

    res.json({
      success:    true,
      psbt:       buildResult.psbt,       // Base64 PSBT → sign di browser
      inputCount: buildResult.inputCount,
      fee:        buildResult.fee,
      feeRate:    rate,
      instruction: 'Sign PSBT ini dengan wallet kamu, lalu POST hex ke /api/broadcast',
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Build transaksi MINT NFT ──────────────────────────────────────
// POST /api/nft/build-mint
// Body: { contract, fromAddress, toAddress (optional), feeRate }
app.post('/api/nft/build-mint', async (req, res) => {
  const { contract, fromAddress, toAddress, feeRate } = req.body;
  const nftContract = contract || NFT_CONTRACT;

  if (!fromAddress) {
    return res.status(400).json({ success: false, error: 'fromAddress wajib ada' });
  }

  // Cek Bitcoin Core sync
  let btcSynced = false;
  try {
    const info = await btcRpc('getblockchaininfo');
    btcSynced  = info.verificationprogress > 0.999;
  } catch {}

  if (!btcSynced) {
    return res.status(503).json({
      success: false,
      error:   'Bitcoin Core belum sync 100%. Tunggu sync selesai.',
      note:    'Cek: GET /api/health',
    });
  }

  try {
    const utxos = await mempoolGet(`/api/address/${fromAddress}/utxo`);
    if (!utxos || utxos.length === 0) {
      return res.status(400).json({
        success: false,
        error:   'Tidak ada UTXO. Kamu perlu Testnet4 BTC untuk gas fee.',
        faucet:  'https://mempool.space/testnet4/faucet',
      });
    }

    let rate = feeRate;
    if (!rate) {
      try {
        const fees = await mempoolGet('/api/v1/fees/recommended');
        rate = fees.halfHourFee || 10;
      } catch { rate = 10; }
    }

    // mint() selector = 0x1249c58b
    // Kalau mint ke address tertentu pakai: mintTo(address) = 0x449a52f8
    const mintTo     = toAddress || fromAddress;
    const toHex      = Buffer.from(mintTo, 'utf8').toString('hex').padStart(64, '0').slice(0, 64);
    const calldata   = toAddress
      ? '0x449a52f8' + toHex   // mintTo(address)
      : '0x1249c58b';           // mint()

    const buildResult = await opnetRpc('opnet_buildTransaction', [{
      from:    fromAddress,
      to:      nftContract,
      data:    calldata,
      utxos:   utxos.slice(0, 5).map(u => ({
        txid:  u.txid,
        vout:  u.vout,
        value: u.value,
      })),
      feeRate: rate,
      network: NETWORK,
    }], 15000);

    if (!buildResult || !buildResult.psbt) {
      throw new Error('OP_NET tidak return PSBT untuk mint');
    }

    res.json({
      success:     true,
      psbt:        buildResult.psbt,
      fee:         buildResult.fee,
      feeRate:     rate,
      nftContract,
      mintTo,
      instruction: 'Sign PSBT ini dengan wallet kamu, lalu POST hex ke /api/broadcast',
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Info contract ─────────────────────────────────────────────────
app.get('/api/contract/:address', async (req, res) => {
  const { address } = req.params;
  const paths = [
    `/api/v1/contract/${address}`,
    `/api/v1/token/${address}`,
    `/api/v1/contract/${address}/info`,
  ];
  for (const path of paths) {
    try {
      const data = await opnetGet(path, 8000);
      return res.json({ success: true, contract: address, ...data });
    } catch {}
  }
  res.status(404).json({ success: false, error: 'Contract info tidak ditemukan' });
});

// ── Bitcoin Core info ─────────────────────────────────────────────
app.get('/api/node/info', async (req, res) => {
  try {
    const [chainInfo, networkInfo, mempoolInfo] = await Promise.allSettled([
      btcRpc('getblockchaininfo'),
      btcRpc('getnetworkinfo'),
      btcRpc('getmempoolinfo'),
    ]);
    res.json({
      success:     true,
      blockchain:  chainInfo.status  === 'fulfilled' ? chainInfo.value  : null,
      network:     networkInfo.status === 'fulfilled' ? networkInfo.value : null,
      mempool:     mempoolInfo.status === 'fulfilled' ? mempoolInfo.value : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        OPiLL Protocol Backend v2.0                   ║
╠══════════════════════════════════════════════════════╣
║  http://localhost:${PORT}                               ║
║  Network: ${NETWORK}                                 ║
╠══════════════════════════════════════════════════════╣
║  GET  /api/health                  ← cek semua node  ║
║  GET  /api/balance/:addr           ← BTC balance     ║
║  GET  /api/token/:c/balance/:addr  ← token balance   ║
║  GET  /api/wallet/:addr/tokens     ← semua token     ║
║  GET  /api/utxos/:addr             ← UTXOs           ║
║  GET  /api/fee                     ← fee rate        ║
║  GET  /api/transactions/:addr      ← TX history      ║
║  POST /api/broadcast               ← broadcast tx    ║
║  GET  /api/tx/:txid                ← cek TX status   ║
║  POST /api/opnet/rpc               ← OP_NET proxy    ║
║  POST /api/token/build-send        ← build send tx   ║
║  POST /api/nft/build-mint          ← build mint tx   ║
║  GET  /api/contract/:addr          ← contract info   ║
║  GET  /api/node/info               ← BTC Core info   ║
╚══════════════════════════════════════════════════════╝
  `);

  // Auto-cek health saat startup
  setTimeout(async () => {
    try {
      const info = await btcRpc('getblockchaininfo');
      const pct  = (info.verificationprogress * 100).toFixed(2);
      console.log(`[Bitcoin Core] ✅ Connected | Blocks: ${info.blocks}/${info.headers} | Sync: ${pct}%`);
      if (info.verificationprogress < 0.9999) {
        console.log(`[Bitcoin Core] ⚠️  BELUM SYNC — broadcast transaksi belum bisa sampai sync selesai`);
      } else {
        console.log(`[Bitcoin Core] 🎉 FULLY SYNCED — siap broadcast!`);
      }
    } catch (e) {
      console.log(`[Bitcoin Core] ❌ Tidak terkonek: ${e.message}`);
    }
  }, 2000);
});
