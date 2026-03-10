const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── HEALTH CHECK ──
app.get('/health', async (req, res) => {
  try {
    const result = await axios.get(`${process.env.BTC_RPC_URL}/blocks/tip/height`);
    res.json({ status: 'ok', network: 'testnet', latestBlock: result.data });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── BALANCE ──
app.get('/api/wallet/:address/btc-balance', async (req, res) => {
  try {
    const { address } = req.params;
    const result = await axios.get(`${process.env.BTC_RPC_URL}/address/${address}`);
    const satoshi = result.data.chain_stats.funded_txo_sum - result.data.chain_stats.spent_txo_sum;
    const btc = satoshi / 100000000;
    res.json({ address, balance: btc, unit: 'BTC' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TX HISTORY ──
app.get('/api/tx/:address/history', async (req, res) => {
  try {
    const { address } = req.params;
    const result = await axios.get(`${process.env.BTC_RPC_URL}/address/${address}/txs`);
    res.json(result.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`[OPill Backend] Running on port ${process.env.PORT || 3001}`);
  console.log(`[OPill Backend] Network: ${process.env.NETWORK}`);
});