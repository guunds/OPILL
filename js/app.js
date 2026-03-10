// app.js — OPILL Protocol main application

document.addEventListener('DOMContentLoaded', async () => {

  // ——————————————————————————————————————————
  // ROUTER
  // ——————————————————————————————————————————
  function navigate(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const page = document.getElementById(`page-${pageId}`);
    const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    if (page) page.classList.add('active');
    if (link) link.classList.add('active');
    if (pageId === 'transactions') loadTransactions();
    if (pageId === 'pool')         loadPools();
    if (pageId === 'faucet')       renderFaucet();
    if (pageId === 'swap')         initSwap();
  }

  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); navigate(link.dataset.page); });
  });
  navigate('dashboard');

  // ——————————————————————————————————————————
  // WALLET EVENTS
  // ——————————————————————————————————————————
  Wallet.onEvent(async (event, data) => {
    if (event === 'connect') {
      renderWalletConnected(data.address);
      toast('Wallet connected', `${Wallet.shortAddr(data.address)}`, 'success');
      // Fetch all data
      await Promise.allSettled([
        OPNetTokens.fetchAllBalances(data.address),
        Price.fetchBtcPrice(),
        Wallet.refreshBtcBalance()
      ]);
      renderWalletBalances();
      loadDashboardStats();
    }
    if (event === 'disconnect') {
      renderWalletDisconnected();
      toast('Wallet disconnected', '', 'info');
    }
    if (event === 'balance') {
      renderWalletBalances();
    }
    if (event === 'error') {
      toast('Wallet error', data.message, 'error');
    }
  });

  // ——————————————————————————————————————————
  // WALLET BUTTON
  // ——————————————————————————————————————————
  document.getElementById('btn-connect-wallet').addEventListener('click', () => {
    if (Wallet.isConnected()) {
      Wallet.disconnect();
    } else {
      openWalletModal();
    }
  });

  function openWalletModal() {
    const wallets = Wallet.detectWallets();
    const list    = document.getElementById('wallet-options-list');
    list.innerHTML = '';

    const allOptions = [
      { id: 'unisat', name: 'UniSat Wallet', icon: '🟠', status: wallets.find(w=>w.id==='unisat') ? 'Detected' : 'Not installed' },
      { id: 'xverse', name: 'Xverse',        icon: '🔷', status: wallets.find(w=>w.id==='xverse') ? 'Detected' : 'Not installed' },
      { id: 'okx',    name: 'OKX Wallet',    icon: '⚫', status: wallets.find(w=>w.id==='okx')    ? 'Detected' : 'Not installed' },
    ];

    allOptions.forEach(w => {
      const div = document.createElement('div');
      div.className = 'wallet-option';
      div.innerHTML = `
        <div class="wallet-option-icon">${w.icon}</div>
        <div>
          <div class="wallet-option-name">${w.name}</div>
          <div class="wallet-option-status">${w.status}</div>
        </div>
      `;
      div.addEventListener('click', async () => {
        closeModal('modal-wallet');
        try {
          toast('Connecting…', w.name, 'info');
          await Wallet.connect(w.id);
        } catch (err) {
          toast('Connection failed', err.message, 'error');
        }
      });
      list.appendChild(div);
    });

    openModal('modal-wallet');
  }

  function renderWalletConnected(address) {
    const btn = document.getElementById('btn-connect-wallet');
    btn.classList.add('connected');
    btn.innerHTML = `<i class="wallet-icon">◉</i> ${Wallet.shortAddr(address)}`;

    document.getElementById('wallet-disconnected').classList.add('hidden');
    document.getElementById('wallet-connected').classList.remove('hidden');
    document.getElementById('wallet-address').textContent = address;
  }

  function renderWalletDisconnected() {
    const btn = document.getElementById('btn-connect-wallet');
    btn.classList.remove('connected');
    btn.innerHTML = `<i class="wallet-icon">◎</i> Connect Wallet`;

    document.getElementById('wallet-disconnected').classList.remove('hidden');
    document.getElementById('wallet-connected').classList.add('hidden');
    document.getElementById('wallet-address').textContent = '';
    document.getElementById('wallet-btc-balance').textContent = '—';
    document.getElementById('wallet-usd-balance').textContent = '—';
    document.getElementById('wallet-tokens-list').innerHTML = '';
  }

  function renderWalletBalances() {
    const btc = Wallet.getBtcBalance();
    const usd = Price.formatUsd(btc);
    document.getElementById('wallet-btc-balance').textContent = btc.toFixed(8) + ' BTC';
    document.getElementById('wallet-usd-balance').textContent = usd;

    const tokens = OPNetTokens.getTokenList();
    const balances = OPNetTokens.getAllBalances();
    const container = document.getElementById('wallet-tokens-list');
    container.innerHTML = tokens.map(t => `
      <div class="token-row">
        <div class="token-info">
          <div class="token-logo" style="color:${t.color}">${t.icon}</div>
          <div>
            <div class="token-symbol">${t.symbol}</div>
            <div class="token-name">${t.name}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="token-amount">${parseFloat(balances[t.symbol]||0).toLocaleString('en-US',{maximumFractionDigits:4})}</div>
          <div class="token-usd text-muted text-xs">${t.symbol}</div>
        </div>
      </div>
    `).join('');

    // Update token balance labels in swap
    updateSwapBalanceLabels();
  }

  // ——————————————————————————————————————————
  // DASHBOARD STATS
  // ——————————————————————————————————————————
  async function loadDashboardStats() {
    // BTC Price
    const btcPrice = await Price.fetchBtcPrice();
    const el = document.getElementById('stat-btc-price');
    if (el) el.textContent = '$' + btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 });

    // OPNet block
    try {
      const block = await OPNet.getBlockNumber();
      const elBlock = document.getElementById('stat-block');
      if (elBlock) elBlock.textContent = '#' + block.toLocaleString();
    } catch {}

    // Gas price
    try {
      const gas = await OPNet.getGasPrice();
      const elGas = document.getElementById('stat-gas');
      if (elGas) elGas.textContent = Math.round(gas / 1e9) + ' gwei';
    } catch {}
  }

  // Load dashboard stats immediately
  Price.startPolling();
  loadDashboardStats();

  // Auto-refresh stats every 30s
  setInterval(loadDashboardStats, 30_000);

  // Recent transactions on dashboard
  async function loadDashboardTxns() {
    const el = document.getElementById('dashboard-recent-txns');
    if (!el) return;
    const local = Storage.getLocalTxns().slice(0, 5);
    if (!local.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No recent transactions</div></div>';
      return;
    }
    el.innerHTML = local.map(tx => txRowHtml(tx, true)).join('');
  }
  loadDashboardTxns();

  // ——————————————————————————————————————————
  // SWAP
  // ——————————————————————————————————————————
  let swapFromToken = 'WBTC';
  let swapToToken   = 'USDT';
  let slippage      = 0.5;

  function initSwap() {
    updateSwapTokenButtons();
    updateSwapOutput();
    updateSwapBalanceLabels();
  }

  function updateSwapTokenButtons() {
    const fromT = OPNetTokens.getToken(swapFromToken);
    const toT   = OPNetTokens.getToken(swapToToken);
    document.getElementById('swap-from-token-btn').innerHTML =
      `<span>${fromT?.icon || ''}</span> ${swapFromToken} ▾`;
    document.getElementById('swap-to-token-btn').innerHTML =
      `<span>${toT?.icon || ''}</span> ${swapToToken} ▾`;
  }

  function updateSwapBalanceLabels() {
    const fromBal = OPNetTokens.getBalance(swapFromToken);
    const toBal   = OPNetTokens.getBalance(swapToToken);
    const fe = document.getElementById('swap-from-balance');
    const te = document.getElementById('swap-to-balance');
    if (fe) fe.textContent = 'Balance: ' + parseFloat(fromBal||0).toFixed(6);
    if (te) te.textContent = 'Balance: ' + parseFloat(toBal||0).toFixed(6);
  }

  function updateSwapOutput() {
    const amtIn = parseFloat(document.getElementById('swap-from-amount')?.value || '0');
    const est = OPNetTokens.estimateSwap(swapFromToken, swapToToken, amtIn);
    const outEl = document.getElementById('swap-to-amount');
    if (outEl) outEl.value = amtIn > 0 ? est.amountOut : '';

    // Update details
    const rate = document.getElementById('swap-rate');
    const fee  = document.getElementById('swap-fee');
    const imp  = document.getElementById('swap-impact');
    const min  = document.getElementById('swap-min');
    if (amtIn > 0) {
      if (rate) rate.textContent = `1 ${swapFromToken} = ${(parseFloat(est.amountOut)/amtIn).toFixed(6)} ${swapToToken}`;
      if (fee)  fee.textContent  = est.fee;
      if (imp)  imp.textContent  = est.priceImpact + '%';
      if (min)  min.textContent  = est.minReceived;
    }
  }

  // From amount input
  document.getElementById('swap-from-amount')?.addEventListener('input', updateSwapOutput);

  // Swap arrow
  document.getElementById('swap-arrow-btn')?.addEventListener('click', () => {
    [swapFromToken, swapToToken] = [swapToToken, swapFromToken];
    const fromAmt = document.getElementById('swap-from-amount');
    const toAmt   = document.getElementById('swap-to-amount');
    if (fromAmt && toAmt) { fromAmt.value = toAmt.value; toAmt.value = ''; }
    updateSwapTokenButtons();
    updateSwapBalanceLabels();
    updateSwapOutput();
  });

  // Max button
  document.getElementById('swap-from-max')?.addEventListener('click', () => {
    const bal = OPNetTokens.getBalance(swapFromToken);
    const el  = document.getElementById('swap-from-amount');
    if (el) { el.value = parseFloat(bal || 0).toFixed(6); updateSwapOutput(); }
  });

  // Token select buttons → open modal
  document.getElementById('swap-from-token-btn')?.addEventListener('click', () => openTokenModal('from'));
  document.getElementById('swap-to-token-btn')?.addEventListener('click',   () => openTokenModal('to'));

  // Slippage buttons
  document.querySelectorAll('.slippage-btn[data-slippage]').forEach(btn => {
    btn.addEventListener('click', () => {
      slippage = parseFloat(btn.dataset.slippage);
      document.querySelectorAll('.slippage-btn[data-slippage]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateSwapOutput();
    });
  });

  // Execute swap
  document.getElementById('btn-swap-execute')?.addEventListener('click', async () => {
    if (!Wallet.isConnected()) { openWalletModal(); return; }
    const amt = parseFloat(document.getElementById('swap-from-amount')?.value || '0');
    if (!amt || amt <= 0) { toast('Enter an amount', '', 'error'); return; }
    const est = OPNetTokens.estimateSwap(swapFromToken, swapToToken, amt);
    // Show confirm modal
    showTxConfirmModal({
      title: `Swap ${swapFromToken} → ${swapToToken}`,
      summary: `${amt} ${swapFromToken} → ${est.amountOut} ${swapToToken}`,
      details: [
        ['From', `${amt} ${swapFromToken}`],
        ['To (min)', est.minReceived],
        ['Price impact', est.priceImpact + '%'],
        ['Fee', est.fee],
        ['Slippage', slippage + '%']
      ],
      onConfirm: async () => {
        toast('Broadcasting swap…', 'Sign in your wallet', 'info');
        try {
          // Real: build + sign PSBT via OPNet
          // For now, this is a placeholder showing the flow
          // await OPNet.rpc('eth_sendTransaction', [{...}])
          toast('Swap submitted', 'Waiting for confirmation…', 'success');
          Storage.addLocalTx({
            hash: '0x' + Math.random().toString(16).slice(2,18),
            type: 'swap',
            from: { symbol: swapFromToken, amount: amt },
            to:   { symbol: swapToToken,   amount: est.amountOut },
            timestamp: Date.now(), status: 'pending'
          });
          loadDashboardTxns();
        } catch (err) {
          toast('Swap failed', err.message, 'error');
        }
      }
    });
  });

  // ——————————————————————————————————————————
  // TOKEN SELECT MODAL
  // ——————————————————————————————————————————
  let _tokenModalTarget = 'from';

  function openTokenModal(target) {
    _tokenModalTarget = target;
    renderTokenList('');
    document.getElementById('token-search-input').value = '';
    openModal('modal-token-select');
  }

  function renderTokenList(query) {
    const tokens = OPNetTokens.getTokenList();
    const filtered = query ? tokens.filter(t =>
      t.symbol.toLowerCase().includes(query.toLowerCase()) ||
      t.name.toLowerCase().includes(query.toLowerCase())
    ) : tokens;

    const list = document.getElementById('token-select-list');
    list.innerHTML = filtered.map(t => {
      const bal = OPNetTokens.getBalance(t.symbol);
      return `
        <div class="token-list-item" data-symbol="${t.symbol}">
          <div class="token-info">
            <div class="token-logo" style="color:${t.color}">${t.icon}</div>
            <div>
              <div class="token-symbol">${t.symbol}</div>
              <div class="token-name text-xs text-muted">${t.name}</div>
            </div>
          </div>
          <div class="token-bal">${parseFloat(bal||0).toFixed(4)}</div>
        </div>
      `;
    }).join('') || '<div class="empty-state"><div class="empty-text">No tokens found</div></div>';

    list.querySelectorAll('.token-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const sym = item.dataset.symbol;
        if (_tokenModalTarget === 'from') {
          if (sym === swapToToken) swapToToken = swapFromToken;
          swapFromToken = sym;
        } else {
          if (sym === swapFromToken) swapFromToken = swapToToken;
          swapToToken = sym;
        }
        closeModal('modal-token-select');
        updateSwapTokenButtons();
        updateSwapBalanceLabels();
        updateSwapOutput();
      });
    });
  }

  document.getElementById('token-search-input')?.addEventListener('input', e => {
    renderTokenList(e.target.value);
  });

  // ——————————————————————————————————————————
  // POOL PAGE
  // ——————————————————————————————————————————
  function loadPools() {
    const pools = OPNetTokens.getPools();
    const tbody = document.getElementById('pools-tbody');
    if (!tbody) return;
    tbody.innerHTML = pools.map(p => {
      const t0 = OPNetTokens.getToken(p.pair[0]);
      const t1 = OPNetTokens.getToken(p.pair[1]);
      return `
        <div class="pool-row">
          <div class="pool-pair">
            <div class="pool-icons">
              <div class="pool-icon" style="color:${t0?.color||'#fff'}">${t0?.icon||'?'}</div>
              <div class="pool-icon" style="color:${t1?.color||'#fff'}">${t1?.icon||'?'}</div>
            </div>
            ${p.pair[0]}/${p.pair[1]}
            <span class="pool-fee">${p.fee}</span>
          </div>
          <div>${p.tvlUsd ? '$'+p.tvlUsd.toLocaleString() : '<span class="text-muted">—</span>'}</div>
          <div>${p.vol24hUsd ? '$'+p.vol24hUsd.toLocaleString() : '<span class="text-muted">—</span>'}</div>
          <div class="pool-apr">${p.apr ? p.apr+'%' : '<span class="text-muted">—</span>'}</div>
          <div>
            <button class="btn btn-secondary" style="padding:5px 12px;font-size:0.7rem"
              onclick="openAddLiqModal('${p.pair[0]}','${p.pair[1]}')">Add</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.openAddLiqModal = function(sym0, sym1) {
    if (!Wallet.isConnected()) { openWalletModal(); return; }
    const modal = document.getElementById('modal-add-liquidity');
    if (!modal) return;
    document.getElementById('addliq-pair-label').textContent = `${sym0} / ${sym1}`;
    document.getElementById('addliq-token0-label').textContent = sym0;
    document.getElementById('addliq-token1-label').textContent = sym1;
    openModal('modal-add-liquidity');
  };

  document.getElementById('btn-add-liquidity-confirm')?.addEventListener('click', async () => {
    closeModal('modal-add-liquidity');
    toast('Add liquidity submitted', 'Waiting for confirmation…', 'success');
    Storage.addLocalTx({
      hash: '0x' + Math.random().toString(16).slice(2,18),
      type: 'add',
      timestamp: Date.now(), status: 'pending'
    });
    loadDashboardTxns();
  });

  // ——————————————————————————————————————————
  // FAUCET PAGE
  // ——————————————————————————————————————————
  function renderFaucet() {
    const list = document.getElementById('faucet-token-list');
    if (!list) return;
    const tokens = OPNetTokens.getTokenList();
    list.innerHTML = tokens.map(t => {
      const cooldown = Faucet.getCooldownRemaining(t.symbol);
      const pct      = Faucet.getCooldownPct(t.symbol);
      const ready    = cooldown <= 0;
      return `
        <div class="faucet-token-item ${ready ? '' : 'disabled'}" data-symbol="${t.symbol}"
             style="opacity:${ready?'1':'0.6'}; cursor:${ready?'pointer':'default'}">
          <div class="token-info">
            <div class="token-logo" style="color:${t.color}">${t.icon}</div>
            <div>
              <div class="token-symbol">${t.symbol}</div>
              <div class="faucet-amount">${t.faucetAmount} ${t.symbol} per claim</div>
            </div>
          </div>
          <div>
            ${ready
              ? `<span class="text-green text-xs">● Ready</span>`
              : `<span class="text-muted text-xs">${Faucet.formatCooldown(cooldown)}</span>`
            }
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.faucet-token-item[data-symbol]').forEach(item => {
      item.addEventListener('click', async () => {
        const sym = item.dataset.symbol;
        if (!Wallet.isConnected()) { openWalletModal(); return; }
        const cooldown = Faucet.getCooldownRemaining(sym);
        if (cooldown > 0) { toast('Cooldown active', Faucet.formatCooldown(cooldown) + ' remaining', 'error'); return; }
        try {
          const btn = document.getElementById('btn-claim-faucet');
          if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
          const result = await Faucet.claim(sym);
          toast('Tokens claimed!', `${result.amount || ''} ${sym} sent to your wallet`, 'success');
          renderFaucet();
        } catch (err) {
          toast('Claim failed', err.message, 'error');
        } finally {
          const btn = document.getElementById('btn-claim-faucet');
          if (btn) { btn.disabled = false; btn.textContent = 'Claim Tokens'; }
        }
      });
    });
  }

  document.getElementById('btn-claim-faucet')?.addEventListener('click', () => {
    // Handled per-token above; this is a fallback general claim for selected token
  });

  // ——————————————————————————————————————————
  // TRANSACTIONS PAGE
  // ——————————————————————————————————————————
  let txFilter = 'all';

  function loadTransactions() {
    const local = Storage.getLocalTxns();
    let filtered = local;
    if (txFilter !== 'all') filtered = local.filter(tx => tx.type === txFilter);

    const tbody = document.getElementById('tx-tbody');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No transactions yet</div></div></td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(tx => `
      <tr>
        <td>
          <a class="tx-hash" href="https://mempool.space/testnet/tx/${tx.hash}" target="_blank">
            ${tx.hash ? tx.hash.slice(0,14)+'…' : '—'}
          </a>
        </td>
        <td><span class="tx-type-badge badge-${tx.type||'swap'}">${tx.type||'swap'}</span></td>
        <td>${txDescription(tx)}</td>
        <td>${tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
        <td><span class="tx-status-${tx.status||'pending'}">${tx.status||'pending'}</span></td>
        <td>
          <a class="link" href="https://mempool.space/testnet/tx/${tx.hash}" target="_blank">View ↗</a>
        </td>
      </tr>
    `).join('');
  }

  function txDescription(tx) {
    if (tx.type === 'swap') return `${tx.from?.amount||''} ${tx.from?.symbol||''} → ${tx.to?.amount||''} ${tx.to?.symbol||''}`;
    if (tx.type === 'faucet') return `Received ${tx.amount||''} ${tx.token||''}`;
    if (tx.type === 'add')    return `Add liquidity`;
    if (tx.type === 'remove') return `Remove liquidity`;
    return tx.hash ? tx.hash.slice(0,16)+'…' : '—';
  }

  document.querySelectorAll('.tx-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      txFilter = btn.dataset.filter;
      document.querySelectorAll('.tx-filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadTransactions();
    });
  });

  function txRowHtml(tx, compact = false) {
    return `
      <div class="token-row" style="cursor:pointer" onclick="window.open('https://mempool.space/testnet/tx/${tx.hash}','_blank')">
        <div class="token-info">
          <div class="token-logo">⇄</div>
          <div>
            <div class="token-symbol"><span class="tx-type-badge badge-${tx.type||'swap'}">${tx.type||'swap'}</span></div>
            <div class="text-xs text-muted">${txDescription(tx)}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="tx-status-${tx.status||'pending'} text-xs">${tx.status||'pending'}</div>
          <div class="text-xs text-muted">${tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : ''}</div>
        </div>
      </div>
    `;
  }

  // ——————————————————————————————————————————
  // TX CONFIRM MODAL
  // ——————————————————————————————————————————
  let _confirmCallback = null;

  function showTxConfirmModal({ title, summary, details, onConfirm }) {
    document.getElementById('tx-confirm-title').textContent = title || 'Confirm Transaction';
    document.getElementById('tx-confirm-big').textContent   = summary || '';
    const det = document.getElementById('tx-confirm-details');
    det.innerHTML = details.map(([k,v]) => `
      <div class="tx-confirm-row"><span>${k}</span><span>${v}</span></div>
    `).join('');
    _confirmCallback = onConfirm;
    openModal('modal-tx-confirm');
  }

  document.getElementById('btn-tx-confirm-ok')?.addEventListener('click', async () => {
    closeModal('modal-tx-confirm');
    if (_confirmCallback) { await _confirmCallback(); _confirmCallback = null; }
  });
  document.getElementById('btn-tx-confirm-cancel')?.addEventListener('click', () => {
    closeModal('modal-tx-confirm');
    _confirmCallback = null;
  });

  // ——————————————————————————————————————————
  // MODAL HELPERS
  // ——————————————————————————————————————————
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
  // Close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });

  window.openModal  = openModal;
  window.closeModal = closeModal;

  // ——————————————————————————————————————————
  // TOAST
  // ——————————————————————————————————————————
  function toast(msg, sub = '', type = 'info') {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <i class="toast-icon">${icons[type]||'ℹ'}</i>
      <div class="toast-msg">${msg}${sub ? `<div class="toast-sub">${sub}</div>` : ''}</div>
      <button class="toast-dismiss">✕</button>
    `;
    el.querySelector('.toast-dismiss').addEventListener('click', () => el.remove());
    container.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 4000);
  }
  window.toast = toast;

  // ——————————————————————————————————————————
  // RESTORE WALLET SESSION ON PAGE LOAD
  // ——————————————————————————————————————————
  const restored = await Wallet.restoreSession();
  if (restored) {
    const addr = Wallet.getAddress();
    renderWalletConnected(addr);
    // Fetch all balances after restore
    await Promise.allSettled([
      OPNetTokens.fetchAllBalances(addr),
      Price.fetchBtcPrice(),
      Wallet.refreshBtcBalance()
    ]);
    renderWalletBalances();
    loadDashboardStats();
  }

  // ——————————————————————————————————————————
  // AUTO REFRESH BALANCE EVERY 30 SECONDS
  // ——————————————————————————————————————————
  setInterval(async () => {
    if (!Wallet.isConnected()) return;
    const addr = Wallet.getAddress();
    await Promise.allSettled([
      Wallet.refreshBtcBalance(),
      OPNetTokens.fetchAllBalances(addr)
    ]);
    renderWalletBalances();
  }, 30000);

}); // end DOMContentLoaded
