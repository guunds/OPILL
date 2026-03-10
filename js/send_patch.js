// ============================================================
//  send_patch.js — OPiLL Protocol
//  Real TX + Real Balance + Real Token Search (all testnets)
//  Overrides: sendSubmit, _syncSendBalances, sendSearchToken
// ============================================================

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  CONSTANTS — Token contracts (real addresses)
  // ─────────────────────────────────────────────────────────
  var TOKEN_CONTRACTS = {
    tBTC:  null,  // native
    OPILL: '0xe3e58e9615ac3e8a29a316c64b8c5930600941096377e227cc456bebb7daf3ee',
    PILL:  '0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb',
    MOTO:  '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd'
  };

  var TOKEN_META = {
    tBTC:  { name: 'Testnet Bitcoin',   icon: '₿',  color: '#f7931a', decimals: 8 },
    OPILL: { name: 'OPiLL Protocol',    icon: '🟠', color: '#00ff88', decimals: 8 },
    PILL:  { name: 'PILL Token',        icon: '💊', color: '#00e5ff', decimals: 8 },
    MOTO:  { name: 'MOTO Token',        icon: '🏍️', color: '#c084fc', decimals: 8 }
  };

  // ALL OP_NET testnet RPC endpoints to try
  var OPNET_RPCS = [
    'https://testnet.opnet.org',
    'https://testnet4.opnet.org',
    'https://regtest.opnet.org'
  ];

  var MEMPOOL_API = 'https://mempool.opnet.org/testnet4/api';
  var MEMPOOL_TX  = 'https://mempool.opnet.org/testnet4/tx/';

  // ─────────────────────────────────────────────────────────
  //  TOKEN SEARCH DATABASE — built from real contract list
  //  Also supports searching by contract address fragment
  // ─────────────────────────────────────────────────────────
  var _tokenSearchDB = Object.keys(TOKEN_CONTRACTS).map(function(sym) {
    var addr = TOKEN_CONTRACTS[sym] || 'native';
    var meta = TOKEN_META[sym] || {};
    return {
      sym:   sym,
      name:  meta.name  || sym,
      addr:  addr,
      icon:  meta.icon  || '🪙',
      color: meta.color || '#ffffff'
    };
  });

  // ─────────────────────────────────────────────────────────
  //  HELPER: Bitcoin address validator (testnet4)
  // ─────────────────────────────────────────────────────────
  function isValidBtcTestnet(addr) {
    if (!addr) return false;
    addr = addr.trim();
    // tb1... (bech32 testnet)
    if (/^tb1[a-z0-9]{25,90}$/i.test(addr)) return true;
    // tBCRT (regtest bech32)
    if (/^bcrt1[a-z0-9]{25,90}$/i.test(addr)) return true;
    // m... or n... (P2PKH testnet)
    if (/^[mn][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) return true;
    // 2... (P2SH testnet)
    if (/^2[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) return true;
    // OP_NET wallet format opt1...
    if (/^opt1[a-z0-9]{20,90}$/i.test(addr)) return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: addr -> 32-byte hex for OP-20 calldata
  //  Encodes Bitcoin address as UTF-8 bytes, right-padded to 32
  // ─────────────────────────────────────────────────────────
  function addrToCalldata(addr) {
    var bytes = [];
    for (var i = 0; i < addr.length && i < 32; i++) {
      bytes.push(addr.charCodeAt(i).toString(16).padStart(2, '0'));
    }
    while (bytes.length < 32) bytes.push('00');
    return bytes.join('');
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: amount -> 32-byte hex (little-endian for OP-20)
  // ─────────────────────────────────────────────────────────
  function amountToHex32(amount, decimals) {
    decimals = decimals || 8;
    var raw = Math.round(amount * Math.pow(10, decimals));
    var hex = raw.toString(16);
    return hex.padStart(64, '0');
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: try multiple RPCs until one works
  // ─────────────────────────────────────────────────────────
  async function rpcCall(method, params) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params });
    for (var i = 0; i < OPNET_RPCS.length; i++) {
      try {
        var r = await fetch(OPNET_RPCS[i], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          signal: AbortSignal.timeout(6000)
        });
        if (!r.ok) continue;
        var j = await r.json();
        if (j.error) continue;
        return j.result;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: broadcast signed tx hex
  // ─────────────────────────────────────────────────────────
  async function broadcastTx(txHex) {
    // 1. Try wallet native push
    var provider = getProvider();
    if (provider) {
      try {
        if (typeof provider.pushTx === 'function') {
          return await provider.pushTx({ rawtx: txHex });
        }
      } catch (e) { /* fallback */ }
    }
    // 2. Try mempool.space testnet4 broadcast
    try {
      var r = await fetch(MEMPOOL_API + '/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex,
        signal: AbortSignal.timeout(10000)
      });
      if (r.ok) return await r.text();
    } catch (e) { /* fallback */ }
    // 3. Try OP_NET RPC eth_sendRawTransaction
    var result = await rpcCall('eth_sendRawTransaction', ['0x' + txHex]);
    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: get wallet provider
  // ─────────────────────────────────────────────────────────
  function getProvider() {
    if (window.opnet) return window.opnet;
    if (window.unisat) return window.unisat;
    if (window.okxwallet && window.okxwallet.bitcoin) return window.okxwallet.bitcoin;
    return null;
  }

  function getWalletType() {
    if (window.Wallet && window.Wallet.state) return window.Wallet.state.type || 'opwallet';
    if (window.opnet) return 'opwallet';
    if (window.unisat) return 'unisat';
    if (window.okxwallet && window.okxwallet.bitcoin) return 'okx';
    return null;
  }

  // ─────────────────────────────────────────────────────────
  //  FETCH: tBTC balance
  // ─────────────────────────────────────────────────────────
  async function fetchBtcBalance(address) {
    // 1. Wallet native
    try {
      var p = getProvider();
      if (p && typeof p.getBalance === 'function') {
        var b = await p.getBalance();
        var sats = b.total || b.confirmed || 0;
        if (sats > 0) return sats / 1e8;
      }
    } catch (e) { /* fallback */ }
    // 2. Wallet state
    if (window.Wallet && window.Wallet.state && window.Wallet.state.balance > 0) {
      return window.Wallet.state.balance / 1e8;
    }
    // 3. Mempool API
    try {
      var r = await fetch(MEMPOOL_API + '/address/' + address, {
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        var d = await r.json();
        var chain = (d.chain_stats || {});
        var mempl = (d.mempool_stats || {});
        var funded   = (chain.funded_txo_sum   || 0) + (mempl.funded_txo_sum   || 0);
        var spent    = (chain.spent_txo_sum    || 0) + (mempl.spent_txo_sum    || 0);
        return Math.max(0, funded - spent) / 1e8;
      }
    } catch (e) { /* */ }
    return 0;
  }

  // ─────────────────────────────────────────────────────────
  //  FETCH: OP-20 token balance — tries 4 methods across all RPCs
  // ─────────────────────────────────────────────────────────
  async function fetchTokenBalance(contractAddr, walletAddr) {
    if (!contractAddr || !walletAddr) return 0;

    // Method 1: Wallet native getBalance().tokens
    try {
      var p = getProvider();
      if (p && typeof p.getBalance === 'function') {
        var wb = await p.getBalance();
        if (wb && wb.tokens) {
          var sc = contractAddr.toLowerCase();
          var found = null;
          if (Array.isArray(wb.tokens)) {
            found = wb.tokens.find(function(t) {
              return t && t.contract && t.contract.toLowerCase() === sc;
            });
          } else if (typeof wb.tokens === 'object') {
            var keys = Object.keys(wb.tokens);
            for (var ki = 0; ki < keys.length; ki++) {
              if (keys[ki].toLowerCase() === sc) {
                found = { balance: wb.tokens[keys[ki]] };
                break;
              }
            }
          }
          if (found && found.balance !== undefined) {
            var bal = parseFloat(found.balance) || 0;
            if (bal > 0) return bal / 1e8;
          }
        }
      }
    } catch (e) { /* next */ }

    // Method 2: OP_NET REST API /api/v1/token/{contract}/balance/{address}
    for (var ri = 0; ri < OPNET_RPCS.length; ri++) {
      try {
        var base = OPNET_RPCS[ri].replace(/\/$/, '');
        var restUrl = base + '/api/v1/token/' + contractAddr + '/balance/' + walletAddr;
        var rr = await fetch(restUrl, { signal: AbortSignal.timeout(5000) });
        if (rr.ok) {
          var rd = await rr.json();
          var rawBal = rd.balance || rd.result || rd.amount || 0;
          if (rawBal && rawBal !== '0') {
            return parseFloat(rawBal) / 1e8;
          }
        }
      } catch (e) { /* next */ }
    }

    // Method 3: eth_call balanceOf — encode wallet address as bytes32
    var calldata = '0x70a08231' + addrToCalldata(walletAddr);
    for (var rj = 0; rj < OPNET_RPCS.length; rj++) {
      try {
        var base2 = OPNET_RPCS[rj];
        var cr = await fetch(base2, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: Date.now(),
            method: 'eth_call',
            params: [{ to: contractAddr, data: calldata }, 'latest']
          }),
          signal: AbortSignal.timeout(6000)
        });
        if (cr.ok) {
          var cj = await cr.json();
          if (cj.result && cj.result !== '0x' && cj.result !== '0x0') {
            var raw = parseInt(cj.result, 16);
            if (!isNaN(raw) && raw > 0) return raw / 1e8;
          }
        }
      } catch (e) { /* next */ }
    }

    // Method 4: POST /api/v1/contract/{contract}/call
    for (var rk = 0; rk < OPNET_RPCS.length; rk++) {
      try {
        var base3 = OPNET_RPCS[rk].replace(/\/$/, '');
        var pr = await fetch(base3 + '/api/v1/contract/' + contractAddr + '/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'balanceOf',
            params: [walletAddr]
          }),
          signal: AbortSignal.timeout(5000)
        });
        if (pr.ok) {
          var pd = await pr.json();
          var b2 = pd.balance || pd.result || 0;
          if (b2 && b2 !== '0') return parseFloat(b2) / 1e8;
        }
      } catch (e) { /* next */ }
    }

    return 0;
  }

  // ─────────────────────────────────────────────────────────
  //  SYNC BALANCES → updates _sendBalances + UI chips
  // ─────────────────────────────────────────────────────────
  window._syncSendBalances = async function () {
    var addr = window.Wallet && window.Wallet.state && window.Wallet.state.address;
    if (!addr) return;

    // BTC
    var btc = await fetchBtcBalance(addr);
    window._sendBalances = window._sendBalances || {};
    window._sendBalances['tBTC'] = btc.toFixed(6);
    _refreshChip('tBTC');

    // OP-20 tokens
    var tokens = ['OPILL', 'PILL', 'MOTO'];
    for (var i = 0; i < tokens.length; i++) {
      (function(sym) {
        var sc = TOKEN_CONTRACTS[sym];
        fetchTokenBalance(sc, addr).then(function(bal) {
          window._sendBalances[sym] = bal > 0 ? bal.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0';
          _refreshChip(sym);
        }).catch(function() {
          window._sendBalances[sym] = '0';
        });
      })(tokens[i]);
    }
  };

  function _refreshChip(tok) {
    var bal = window._sendBalances && window._sendBalances[tok];
    var el = document.getElementById('send-bal-' + tok.toLowerCase());
    if (el && bal) el.textContent = bal + ' ' + tok;
    // also update currently selected token display
    if (window._sendSelectedToken === tok) {
      var balEl = document.getElementById('send-selected-bal');
      if (balEl) balEl.textContent = bal + ' ' + tok;
    }
    // update the token grid chip
    document.querySelectorAll('.send-tok-btn').forEach(function(btn) {
      if (btn.getAttribute('data-tok') === tok) {
        var b = btn.querySelector('.send-tok-bal');
        if (b) b.textContent = bal || '—';
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  //  TOKEN SEARCH — real contract addresses + multi-network
  // ─────────────────────────────────────────────────────────
  window.sendSearchToken = function (val) {
    var clearBtn = document.getElementById('send-search-clear');
    var results  = document.getElementById('send-search-results');
    if (!results) return;

    val = (val || '').trim().toLowerCase();
    if (!val) {
      results.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    if (clearBtn) clearBtn.style.display = 'flex';

    var matches = _tokenSearchDB.filter(function(t) {
      return t.sym.toLowerCase().includes(val) ||
             t.name.toLowerCase().includes(val) ||
             t.addr.toLowerCase().includes(val);
    });

    // If no match but looks like a contract address → search all RPCs live
    var looksLikeContract = val.startsWith('0x') && val.length >= 6;

    if (matches.length === 0 && looksLikeContract) {
      results.style.display = 'block';
      results.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--orange);text-align:center">🔍 Searching all testnets for contract...</div>';
      _searchContractAllNetworks(val, results);
      return;
    }

    if (matches.length === 0) {
      results.style.display = 'block';
      results.innerHTML = '<div style="padding:14px 16px;font-size:12px;color:var(--text-muted);text-align:center">No token found for "' + val + '"</div>';
      return;
    }

    results.style.display = 'block';
    results.innerHTML = matches.map(function(t) {
      var addrDisplay = t.addr === 'native' ? 'Native Bitcoin' : (t.addr.slice(0, 14) + '...' + t.addr.slice(-8));
      return '<div onclick="sendPickSearchToken(\'' + t.sym + '\')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s" onmouseover="this.style.background=\'rgba(247,147,26,0.08)\'" onmouseout="this.style.background=\'transparent\'">'
        + '<div style="font-size:20px;width:28px;text-align:center">' + t.icon + '</div>'
        + '<div style="flex:1;min-width:0">'
        +   '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:13px;color:' + t.color + '">' + t.sym + '</div>'
        +   '<div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + t.name + '</div>'
        +   '<div style="font-size:9px;color:rgba(255,255,255,0.25);font-family:monospace;margin-top:2px">' + addrDisplay + '</div>'
        + '</div>'
        + '<div style="font-size:10px;color:var(--orange);font-weight:700;opacity:0.7">SELECT →</div>'
        + '</div>';
    }).join('');
  };

  // Search unknown contract address across all OP_NET testnet RPCs
  async function _searchContractAllNetworks(contractAddr, resultsEl) {
    var found = null;

    for (var ri = 0; ri < OPNET_RPCS.length; ri++) {
      try {
        var base = OPNET_RPCS[ri].replace(/\/$/, '');
        // Try get token info
        var infoUrl = base + '/api/v1/token/' + contractAddr;
        var r = await fetch(infoUrl, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          var d = await r.json();
          if (d && (d.symbol || d.name || d.decimals !== undefined)) {
            found = {
              sym:  d.symbol || 'UNKNOWN',
              name: d.name   || 'Unknown Token',
              addr: contractAddr,
              icon: '🪙',
              color: '#ffffff',
              decimals: d.decimals || 8,
              network: OPNET_RPCS[ri]
            };
            break;
          }
        }
      } catch (e) { /* next */ }
    }

    if (!found) {
      // Try eth_call name() selector 0x06fdde03
      for (var rj = 0; rj < OPNET_RPCS.length; rj++) {
        try {
          var nr = await fetch(OPNET_RPCS[rj], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: Date.now(),
              method: 'eth_call',
              params: [{ to: contractAddr, data: '0x06fdde03' }, 'latest']
            }),
            signal: AbortSignal.timeout(5000)
          });
          if (nr.ok) {
            var nj = await nr.json();
            if (nj.result && nj.result !== '0x' && nj.result.length > 10) {
              // decode UTF-8 name from hex result
              var hex = nj.result.slice(2);
              var name = '';
              try {
                // skip first 64 bytes (offset) + 64 bytes (length), then decode
                var offset = parseInt(hex.slice(0, 64), 16) * 2;
                var length = parseInt(hex.slice(64, 128), 16) * 2;
                var nameHex = hex.slice(128, 128 + length);
                for (var ci = 0; ci < nameHex.length; ci += 2) {
                  var cc = parseInt(nameHex.slice(ci, ci + 2), 16);
                  if (cc > 0) name += String.fromCharCode(cc);
                }
              } catch (de) { name = 'Unknown Token'; }

              found = {
                sym:     name.toUpperCase().slice(0, 8) || 'UNKNOWN',
                name:    name || 'Unknown Token',
                addr:    contractAddr,
                icon:    '🪙',
                color:   '#ffffff',
                decimals: 8,
                network: OPNET_RPCS[rj]
              };
              break;
            }
          }
        } catch (e) { /* next */ }
      }
    }

    if (!resultsEl) return;

    if (!found) {
      resultsEl.innerHTML = '<div style="padding:14px 16px;font-size:12px;color:rgba(255,68,68,0.9);text-align:center">❌ Contract not found on any OP_NET testnet<br><span style="color:var(--text-muted);font-size:10px;margin-top:4px;display:block">' + contractAddr.slice(0, 18) + '...</span></div>';
      return;
    }

    // Add to DB temporarily so it can be selected
    var alreadyIn = _tokenSearchDB.find(function(t) { return t.addr === found.addr; });
    if (!alreadyIn) {
      _tokenSearchDB.push(found);
      TOKEN_CONTRACTS[found.sym] = found.addr;
      TOKEN_META[found.sym] = { name: found.name, icon: found.icon, color: found.color, decimals: found.decimals };
    }

    var addrDisplay = found.addr.slice(0, 14) + '...' + found.addr.slice(-8);
    var networkLabel = found.network.replace('https://', '').replace('/','');

    resultsEl.innerHTML = '<div onclick="sendPickSearchToken(\'' + found.sym + '\')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s;background:rgba(0,255,136,0.04)" onmouseover="this.style.background=\'rgba(247,147,26,0.08)\'" onmouseout="this.style.background=\'rgba(0,255,136,0.04)\'">'
      + '<div style="font-size:20px;width:28px;text-align:center">' + found.icon + '</div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:13px;color:' + found.color + '">' + found.sym + '</div>'
      +   '<div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + found.name + '</div>'
      +   '<div style="font-size:9px;color:rgba(0,255,136,0.4);font-family:monospace;margin-top:2px">✓ Found on ' + networkLabel + '</div>'
      +   '<div style="font-size:9px;color:rgba(255,255,255,0.2);font-family:monospace">' + addrDisplay + '</div>'
      + '</div>'
      + '<div style="font-size:10px;color:var(--orange);font-weight:700;opacity:0.7">SELECT →</div>'
      + '</div>';
  }

  // ─────────────────────────────────────────────────────────
  //  UPDATE _sendContracts with real addresses
  // ─────────────────────────────────────────────────────────
  window._sendContracts = {
    'tBTC':  'Native tBTC (OP_NET Testnet4)',
    'OPILL': TOKEN_CONTRACTS.OPILL,
    'PILL':  TOKEN_CONTRACTS.PILL,
    'MOTO':  TOKEN_CONTRACTS.MOTO
  };

  // ─────────────────────────────────────────────────────────
  //  MAIN: sendSubmit — REAL TRANSACTIONS
  // ─────────────────────────────────────────────────────────
  window.sendSubmit = async function () {
    var recipientEl = document.getElementById('send-recipient');
    var amountEl    = document.getElementById('send-amount');
    var btn         = document.getElementById('send-btn');

    var recipient = (recipientEl ? recipientEl.value : '').trim();
    var amount    = parseFloat(amountEl ? amountEl.value : '0');
    var token     = window._sendSelectedToken || 'tBTC';

    // ── Validation ──
    if (!window.Wallet || !window.Wallet.state || !window.Wallet.state.address) {
      sendShowStatus('⚠️ Connect wallet first!', '#ff4466'); return;
    }
    if (!recipient) {
      sendShowStatus('⚠️ Enter recipient address!', '#ff4466'); return;
    }
    if (!isValidBtcTestnet(recipient)) {
      sendShowStatus('⚠️ Invalid Bitcoin testnet address!', '#ff4466'); return;
    }
    if (!amount || amount <= 0) {
      sendShowStatus('⚠️ Enter a valid amount!', '#ff4466'); return;
    }

    var fromAddr = window.Wallet.state.address;
    var provider = getProvider();
    if (!provider) {
      sendShowStatus('⚠️ Wallet provider not found!', '#ff4466'); return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending...'; }
    sendShowStatus('📝 Confirm in your wallet...', '#f7931a');

    try {
      var txid = null;

      // ══════════════════════════════════════════════════════
      //  CASE 1: tBTC — native Bitcoin transfer
      // ══════════════════════════════════════════════════════
      if (token === 'tBTC') {
        var sats = Math.round(amount * 1e8);
        if (sats < 546) throw new Error('Amount too small (min 546 sats / dust limit)');

        var wType = getWalletType();
        if (wType === 'opwallet' || wType === 'unisat') {
          txid = await provider.sendBitcoin(recipient, sats);
        } else if (wType === 'okx') {
          txid = await window.okxwallet.bitcoin.sendBitcoin(recipient, sats);
        } else if (wType === 'xverse') {
          var xp = window.XverseProviders && window.XverseProviders.BitcoinProvider;
          if (xp) {
            var xresp = await xp.request('sendBtcTransaction', {
              recipients: [{ address: recipient, amountSats: sats }],
              senderAddress: fromAddr
            });
            txid = xresp && xresp.result && xresp.result.txid;
          }
        }
        if (!txid) throw new Error('sendBitcoin returned no txid');

      // ══════════════════════════════════════════════════════
      //  CASE 2: OP-20 Token transfer
      // ══════════════════════════════════════════════════════
      } else {
        var contractAddr = TOKEN_CONTRACTS[token];
        if (!contractAddr) throw new Error('Unknown token contract for ' + token);

        var decimals = (TOKEN_META[token] && TOKEN_META[token].decimals) || 8;

        // Encode transfer(address,uint256) calldata
        // selector: 0xa9059cbb
        var toBytes   = addrToCalldata(recipient);
        var amtBytes  = amountToHex32(amount, decimals);
        var calldata  = '0xa9059cbb' + toBytes + amtBytes;

        var wType2 = getWalletType();

        // Try wallet-native contract call first
        if (wType2 === 'opwallet' || wType2 === 'unisat') {
          // OP_NET wallet: use sendBitcoin for OP-20 via contract interaction
          // Some versions support eth_sendTransaction style
          if (typeof provider.sendTransaction === 'function') {
            txid = await provider.sendTransaction({
              to:   contractAddr,
              data: calldata
            });
          } else if (typeof provider.contractCall === 'function') {
            txid = await provider.contractCall({
              contractAddress: contractAddr,
              method: 'transfer',
              params: [recipient, String(Math.round(amount * Math.pow(10, decimals)))]
            });
          } else {
            // Fallback: broadcast via RPC directly
            txid = await _broadcastOP20Transfer(contractAddr, calldata, fromAddr);
          }
        } else if (wType2 === 'okx') {
          txid = await window.okxwallet.bitcoin.contractInteraction({
            contractAddress: contractAddr,
            method: 'transfer',
            params: [recipient, String(Math.round(amount * Math.pow(10, decimals)))]
          });
        } else {
          txid = await _broadcastOP20Transfer(contractAddr, calldata, fromAddr);
        }

        if (!txid) throw new Error('Token transfer returned no txid');
      }

      // ── SUCCESS ──
      var txUrl = MEMPOOL_TX + txid;
      sendShowStatus(
        '✅ Sent! <a href="' + txUrl + '" target="_blank" rel="noopener" style="color:#f7931a;font-weight:700">'
        + txid.slice(0, 10) + '...' + txid.slice(-6) + ' ↗</a>',
        '#00ff88'
      );

      // Save to history
      var now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (window._sendHistory) {
        window._sendHistory.unshift({
          time: now, token: token, amount: amount,
          to: recipient, status: 'confirmed', txid: txid
        });
        if (typeof window.sendRenderHistory === 'function') sendRenderHistory();
      }

      // Save to Storage/localStorage
      if (window.Storage && typeof window.Storage.addLocalTx === 'function') {
        window.Storage.addLocalTx({
          hash: txid, type: 'send', token: token,
          amount: amount, address: fromAddr,
          timestamp: Date.now(), status: 'pending'
        });
      }

      // Reset form after 4s
      setTimeout(function () {
        if (btn) { btn.disabled = false; btn.textContent = '📤 Send'; }
        if (amountEl) amountEl.value = '';
        if (recipientEl) recipientEl.value = '';
        var se = document.getElementById('send-status');
        if (se) se.style.display = 'none';
        var pe = document.getElementById('send-preview');
        if (pe) pe.style.display = 'none';
      }, 4000);

      // Refresh balances
      setTimeout(window._syncSendBalances, 3000);

    } catch (err) {
      console.error('[sendSubmit]', err);
      sendShowStatus('❌ ' + (err.message || 'Transaction failed'), '#ff4466');
      if (btn) { btn.disabled = false; btn.textContent = '📤 Send'; }
    }
  };

  // Fallback OP-20 broadcast via raw RPC
  async function _broadcastOP20Transfer(contractAddr, calldata, fromAddr) {
    // Try OP_NET eth_sendTransaction (unsigned, wallet signs internally)
    var result = await rpcCall('eth_sendTransaction', [{
      from: fromAddr,
      to:   contractAddr,
      data: calldata,
      gas:  '0x15F90' // 90000
    }]);
    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  HELPER: sendShowStatus (safe wrapper)
  // ─────────────────────────────────────────────────────────
  if (typeof window.sendShowStatus !== 'function') {
    window.sendShowStatus = function(msg, color) {
      var el = document.getElementById('send-status');
      if (!el) return;
      el.style.display = 'block';
      el.style.color   = color || '#ffffff';
      el.innerHTML     = msg;
    };
  }

  // ─────────────────────────────────────────────────────────
  //  INIT — called on wallet connect + DOMContentLoaded
  // ─────────────────────────────────────────────────────────
  function _init() {
    // Override _sendContracts with real addresses
    window._sendContracts = window._sendContracts || {};
    Object.keys(TOKEN_CONTRACTS).forEach(function(sym) {
      window._sendContracts[sym] = TOKEN_CONTRACTS[sym] || 'native';
    });

    // Sync balances if wallet already connected
    if (window.Wallet && window.Wallet.state && window.Wallet.state.connected) {
      window._syncSendBalances();
    }

    // Listen for wallet connect event
    if (window.Wallet && typeof window.Wallet.on === 'function') {
      window.Wallet.on('connect', function() {
        setTimeout(window._syncSendBalances, 800);
      });
    } else {
      // Fallback: poll for wallet connection
      var pollCount = 0;
      var poll = setInterval(function() {
        pollCount++;
        if ((window.Wallet && window.Wallet.state && window.Wallet.state.connected) || pollCount > 30) {
          clearInterval(poll);
          if (window.Wallet && window.Wallet.state && window.Wallet.state.connected) {
            window._syncSendBalances();
          }
        }
      }, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    setTimeout(_init, 100);
  }

  console.log('[send_patch.js] ✅ Loaded — real TX + real balances + multi-network token search');

})();
