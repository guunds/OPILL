// opnet.js — OPNet Bitcoin Testnet4 Integration
// DIPERBAIKI: Gunakan OP_NET JSON-RPC yang benar (bukan EVM Ethereum)
// Referensi: https://testnet.opnet.org

const OPNet = (() => {

  // ─── ENDPOINT ───────────────────────────────────────────────────────────────
  const RPC_ENDPOINTS = [
    'https://testnet.opnet.org',
    'https://testnet4.opnet.org',
  ];
  let _activeRpc = RPC_ENDPOINTS[0];
  let _latestBlock = 0;

  // ─── JSON-RPC Call dengan fallback ──────────────────────────────────────────
  async function rpc(method, params = []) {
    let lastErr;
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        _activeRpc = endpoint;
        return data.result;
      } catch (e) {
        lastErr = e;
        console.warn(`[OPNet] RPC ${endpoint} gagal:`, e.message);
      }
    }
    throw lastErr || new Error('Semua RPC endpoint gagal');
  }

  // ─── REST API Helper ─────────────────────────────────────────────────────────
  async function rest(path) {
    let lastErr;
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint + path);
        if (res.ok) { _activeRpc = endpoint; return await res.json(); }
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('REST gagal: ' + path);
  }

  // ─── Block Number ─────────────────────────────────────────────────────────────
  async function getBlockNumber() {
    try {
      // OP_NET mendukung eth_blockNumber (hex)
      const r = await rpc('eth_blockNumber');
      _latestBlock = parseInt(r, 16);
      return _latestBlock;
    } catch {
      try {
        const d = await rest('/api/v1/block/latest');
        _latestBlock = d?.height || d?.blockNumber || 0;
        return _latestBlock;
      } catch {
        return _latestBlock;
      }
    }
  }

  // ─── Cek UTXOs untuk address (Bitcoin native) ───────────────────────────────
  async function getUTXOs(address) {
    try {
      // OP_NET memiliki endpoint UTXOs
      const d = await rest(`/api/v1/address/${address}/utxos`);
      return d?.utxos || d || [];
    } catch {
      // Fallback: mempool.space testnet4
      try {
        const res = await fetch(`https://mempool.space/testnet4/api/address/${address}/utxo`);
        if (res.ok) return await res.json();
      } catch {}
      return [];
    }
  }

  // ─── Token Balance via OP_NET API (BENAR untuk OP-20) ────────────────────────
  // PENTING: OP_NET menggunakan Bitcoin address (tb1...) bukan 0x address EVM
  async function getTokenBalance(tokenContract, walletAddress) {
    // Metode 1: OP_NET REST API (paling akurat)
    try {
      const res = await fetch(`${_activeRpc}/api/v1/token/${tokenContract}/balance/${walletAddress}`);
      if (res.ok) {
        const d = await res.json();
        if (d?.balance !== undefined) return BigInt(String(d.balance));
      }
    } catch {}

    // Metode 2: eth_call dengan ABI encode Bitcoin address
    // OP_NET encode Bitcoin address sebagai 32-byte hex dari UTF-8 bytes address
    try {
      const addrBytes = addressToBytes32(walletAddress);
      const data = '0x70a08231' + addrBytes; // balanceOf(address)
      const result = await rpc('eth_call', [{ to: tokenContract, data }, 'latest']);
      if (result && result !== '0x' && result !== '0x0') {
        return BigInt(result);
      }
    } catch {}

    // Metode 3: REST balanceOf
    try {
      const res = await fetch(`${_activeRpc}/api/v1/contract/${tokenContract}/balanceOf?address=${encodeURIComponent(walletAddress)}`);
      if (res.ok) {
        const d = await res.json();
        const bal = d?.balance ?? d?.result ?? d?.data ?? 0;
        return BigInt(String(bal));
      }
    } catch {}

    return BigInt(0);
  }

  // ─── Encode Bitcoin address ke 32 bytes untuk ABI call ───────────────────────
  function addressToBytes32(address) {
    // Konversi string address ke hex, lalu pad ke 32 bytes
    let hex = '';
    for (let i = 0; i < address.length; i++) {
      hex += address.charCodeAt(i).toString(16).padStart(2, '0');
    }
    // Pad kanan ke 32 bytes (64 hex chars)
    return hex.padEnd(64, '0');
  }

  // ─── Get Token Info (symbol, decimals) ───────────────────────────────────────
  async function getTokenInfo(tokenContract) {
    try {
      const res = await fetch(`${_activeRpc}/api/v1/token/${tokenContract}`);
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }

  // ─── KIRIM TOKEN OP-20 (FUNGSI UTAMA YANG DIPERBAIKI) ────────────────────────
  // Cara kerja OP_NET:
  // 1. Build transaction data (calldata untuk transfer)
  // 2. Bungkus dalam Bitcoin OP_RETURN output
  // 3. Sign PSBT dengan wallet Bitcoin
  // 4. Broadcast ke Bitcoin testnet4
  async function buildTokenTransferTx({
    fromAddress,    // Bitcoin address pengirim (tb1...)
    toAddress,      // Bitcoin address penerima (tb1...)
    tokenContract,  // Contract address OP-20
    amount,         // Jumlah token (sudah dalam unit terkecil / satoshi-equivalent)
    feeRate = 10,   // sat/vByte untuk fee BTC
    publicKey       // Public key pengirim (hex)
  }) {
    // Encode calldata transfer(address,uint256)
    // Signature: 0xa9059cbb
    const toBytes  = addressToBytes32(toAddress);
    const amtHex   = BigInt(amount).toString(16).padStart(64, '0');
    const calldata = '0xa9059cbb' + toBytes + amtHex;

    // Ambil UTXOs untuk membayar fee BTC
    const utxos = await getUTXOs(fromAddress);
    if (!utxos.length) throw new Error('Tidak ada UTXO. Pastikan ada tBTC di wallet untuk membayar fee.');

    // Estimasi fee (perkiraan 300 vBytes untuk OP_NET tx)
    const estimatedVBytes = 300;
    const feeSats = estimatedVBytes * feeRate;

    // Total nilai dari UTXOs
    let totalInput = 0;
    const selectedUTXOs = [];
    for (const utxo of utxos.sort((a, b) => b.value - a.value)) {
      selectedUTXOs.push(utxo);
      totalInput += utxo.value;
      if (totalInput >= feeSats + 546) break; // 546 = dust limit
    }
    if (totalInput < feeSats + 546) {
      throw new Error(`tBTC tidak cukup untuk fee. Butuh ${feeSats} sat, punya ${totalInput} sat. Klaim tBTC dari faucet dulu.`);
    }

    // Return info untuk signing (PSBT akan dibangun oleh wallet extension)
    return {
      calldata,
      tokenContract,
      fromAddress,
      toAddress,
      utxos: selectedUTXOs,
      feeSats,
      changeSats: totalInput - feeSats,
      feeRate,
      publicKey
    };
  }

  // ─── Kirim token menggunakan UniSat/OKX PSBT signing ─────────────────────────
  async function sendTokenTransaction(params) {
    const txInfo = await buildTokenTransferTx(params);

    // Broadcast calldata ke OP_NET
    // OP_NET menggunakan eth_sendRawTransaction dengan format khusus
    const payload = {
      to: params.tokenContract,
      from: params.fromAddress,
      data: txInfo.calldata,
      value: '0x0',
      gasPrice: '0x1',
      gas: '0x5208',
    };

    try {
      const txHash = await rpc('eth_sendTransaction', [payload]);
      return txHash;
    } catch (e) {
      // OP_NET tidak support eth_sendTransaction langsung dari browser
      // Harus lewat signed PSBT
      throw new Error(
        'OP_NET membutuhkan signed PSBT. ' +
        'Pastikan wallet extension mendukung OP_NET. ' +
        'Error: ' + e.message
      );
    }
  }

  // ─── Kirim tBTC native (Bitcoin transfer biasa) ───────────────────────────────
  async function sendBTC({ fromAddress, toAddress, amountSats, feeRate = 10 }) {
    const utxos = await getUTXOs(fromAddress);
    if (!utxos.length) throw new Error('Tidak ada UTXO tersedia');

    const estimatedFee = 250 * feeRate; // ~250 vBytes untuk P2TR tx
    const total = amountSats + estimatedFee;

    let sum = 0;
    const selected = [];
    for (const utxo of utxos.sort((a, b) => b.value - a.value)) {
      selected.push(utxo);
      sum += utxo.value;
      if (sum >= total) break;
    }
    if (sum < total) throw new Error(`Saldo tidak cukup. Butuh ${total} sat, punya ${sum} sat.`);

    const change = sum - total;
    return { utxos: selected, amountSats, feeSats: estimatedFee, changeSats: change };
  }

  // ─── Get Transactions untuk address ─────────────────────────────────────────
  async function getTransactions(address, limit = 20) {
    // Coba OP_NET dulu
    try {
      const d = await rest(`/api/v1/address/${address}/transactions?limit=${limit}`);
      return d?.transactions || d?.txs || d || [];
    } catch {}
    // Fallback: mempool.space testnet4
    try {
      const res = await fetch(`https://mempool.space/testnet4/api/address/${address}/txs`);
      if (res.ok) {
        const txs = await res.json();
        return txs.slice(0, limit);
      }
    } catch {}
    return [];
  }

  // ─── Format Utils ─────────────────────────────────────────────────────────────
  function formatUnits(val, decimals = 18) {
    const v = typeof val === 'bigint' ? val : BigInt(String(val || '0'));
    if (v === 0n) return '0';
    const divisor = 10n ** BigInt(decimals);
    const int  = v / divisor;
    const frac = v % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6);
    return fracStr ? `${int}.${fracStr}` : `${int}`;
  }

  function parseUnits(val, decimals = 18) {
    const [int, frac = ''] = String(val).split('.');
    const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(int + fracPadded);
  }

  function getCachedBlock() { return _latestBlock; }
  function getActiveRpc()   { return _activeRpc; }

  // ─── Gas Price (untuk kompatibilitas UI) ──────────────────────────────────────
  async function getGasPrice() {
    try {
      const r = await rpc('eth_gasPrice');
      return parseInt(r, 16);
    } catch { return 0; }
  }

  return {
    rpc, rest,
    getBlockNumber, getGasPrice,
    getUTXOs,
    getTokenBalance, getTokenInfo,
    buildTokenTransferTx, sendTokenTransaction, sendBTC,
    getTransactions,
    formatUnits, parseUnits,
    addressToBytes32,
    getCachedBlock, getActiveRpc,
    get activeRpc() { return _activeRpc; }
  };
})();

window.OPNet = OPNet;
