// send_patch.js — Real transaction engine for OPiLL Protocol
// Compatible with index.html inline Wallet API (Wallet.state.address etc.)
// Overrides: sendSubmit(), _sendContracts with real addresses, sendSearchToken()
// OP_WALLET = window.opnet (fork of UniSat — identical API)

(function() {
'use strict';

var REAL_CONTRACTS = {
  tBTC:  null,
  OPILL: '0xe3e58e9615ac3e8a29a316c64b8c5930600941096377e227cc456bebb7daf3ee',
  PILL:  '0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb',
  MOTO:  '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd'
};
var DECIMALS = { tBTC: 8, OPILL: 8, PILL: 8, MOTO: 8 };
var OPNET_RPCS = ['https://testnet.opnet.org', 'https://testnet4.opnet.org'];

function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

ready(function() {
  // Fix _sendContracts with real addresses
  if (typeof _sendContracts !== 'undefined') {
    _sendContracts.tBTC  = 'Native tBTC (OP_NET Testnet4)';
    _sendContracts.OPILL = REAL_CONTRACTS.OPILL;
    _sendContracts.PILL  = REAL_CONTRACTS.PILL;
    _sendContracts.MOTO  = REAL_CONTRACTS.MOTO;
  }
  if (typeof _sendTokenList !== 'undefined') {
    _sendTokenList.forEach(function(t) {
      if (REAL_CONTRACTS[t.sym]) t.addr = REAL_CONTRACTS[t.sym];
    });
  }
  if (typeof sendFillContract === 'function') sendFillContract();
});

// ─── Compat helpers ───────────────────────────────────────────
function walletAddr() {
  return (window.Wallet?.state?.address) || (typeof Wallet?.getAddress === 'function' ? Wallet.getAddress() : null);
}
function walletType() {
  return (window.Wallet?.state?.type) || (typeof Wallet?.getProvider === 'function' ? Wallet.getProvider() : null);
}
function walletConnected() { return !!walletAddr(); }
function walletProvObj() {
  switch (walletType()) {
    case 'opwallet': return window.opnet;
    case 'unisat':   return window.unisat;
    case 'okx':      return window.okxwallet?.bitcoin;
    case 'xverse':   return window.BitcoinProvider || window.XverseProviders?.BitcoinProvider;
    default: return null;
  }
}

// ─── RPC helpers ─────────────────────────────────────────────
async function rpc(method, params) {
  var lastErr;
  for (var i=0;i<OPNET_RPCS.length;i++) {
    try {
      var r = await fetch(OPNET_RPCS[i], {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',id:Date.now(),method:method,params:params||[]})
      });
      var d = await r.json();
      if (d.error) throw new Error(d.error.message||JSON.stringify(d.error));
      return d.result;
    } catch(e){lastErr=e;}
  }
  throw lastErr;
}
async function restGet(path) {
  var lastErr;
  for (var i=0;i<OPNET_RPCS.length;i++) {
    try { var r=await fetch(OPNET_RPCS[i]+path); if(r.ok) return await r.json(); }
    catch(e){lastErr=e;}
  }
  throw lastErr;
}

// ─── Encoding ──────────────────────────────────────────────
function addrCalldata(addr) {
  var bytes=new TextEncoder().encode(addr), hex='';
  for(var i=0;i<bytes.length;i++) hex+=bytes[i].toString(16).padStart(2,'0');
  return hex.padEnd(64,'0');
}
function amtHex32(amt,dec) {
  var s=String(parseFloat(amt).toFixed(dec)).split('.');
  var ip=s[0]||'0', fp=(s[1]||'')+'0'.repeat(dec);
  fp=fp.slice(0,dec);
  var raw=BigInt(ip)*(10n**BigInt(dec))+BigInt(fp||'0');
  return raw.toString(16).padStart(64,'0');
}
function fmtUnits(val,dec) {
  try {
    var v=typeof val==='bigint'?val:BigInt(String(val||'0'));
    if(v===0n)return '0';
    var d=10n**BigInt(dec);
    var ip=v/d, fp=v%d;
    var fs=fp.toString().padStart(dec,'0').slice(0,6).replace(/0+$/,'');
    return fs?(ip+'.'+fs):String(ip);
  } catch {return '0';}
}
function decodeABIStr(hex) {
  try {
    var b=(hex||'').replace('0x','');
    if(b.length<192){
      return (b.match(/.{2}/g)||[]).map(x=>String.fromCharCode(parseInt(x,16))).filter(c=>c.charCodeAt(0)>31).join('').trim();
    }
    var len=parseInt(b.slice(128,192),16);
    return (b.slice(192,192+len*2).match(/.{2}/g)||[]).map(x=>String.fromCharCode(parseInt(x,16))).join('').replace(/\0/g,'').trim();
  } catch{return '';}
}

function isValidAddr(a) {
  if(!a||typeof a!=='string')return false;
  a=a.trim();
  return /^tb1[a-z0-9]{6,}/i.test(a)||/^[mn2][a-zA-Z0-9]{25,34}$/.test(a)||/^opt1[a-z0-9]{6,}/i.test(a);
}

// ─── Balance sync ──────────────────────────────────────────
async function syncSendBalances() {
  var addr=walletAddr(); if(!addr)return;
  try {
    var r=await fetch('https://mempool.space/testnet4/api/address/'+addr);
    if(r.ok){
      var d=await r.json();
      var sats=d.chain_stats.funded_txo_sum-d.chain_stats.spent_txo_sum;
      var bal=(sats/1e8).toFixed(8);
      if(typeof _sendBalances!=='undefined') _sendBalances.tBTC=bal;
    }
  } catch{}
  for(var tok of ['OPILL','PILL','MOTO']) {
    var ct=REAL_CONTRACTS[tok]; if(!ct)continue;
    try {
      var info=await restGet('/api/v1/token/'+ct+'/balance/'+addr);
      if(info?.balance!==undefined){
        var fmt=fmtUnits(BigInt(String(info.balance)),DECIMALS[tok]);
        if(typeof _sendBalances!=='undefined') _sendBalances[tok]=fmt;
        continue;
      }
    } catch{}
    try {
      var result=await rpc('eth_call',[{to:ct,data:'0x70a08231'+addrCalldata(addr)},'latest']);
      if(result&&result!=='0x'&&result!=='0x0'){
        var fmt2=fmtUnits(BigInt(result),DECIMALS[tok]);
        if(typeof _sendBalances!=='undefined') _sendBalances[tok]=fmt2;
      }
    } catch{}
  }
  var tok2=typeof _sendSelectedToken!=='undefined'?_sendSelectedToken:'tBTC';
  var balEl=document.getElementById('send-balance');
  if(balEl&&typeof _sendBalances!=='undefined') balEl.textContent=(_sendBalances[tok2]||'0')+' '+tok2;
}

// ─── sendSubmit OVERRIDE ──────────────────────────────────
window.sendSubmit = async function() {
  function showStatus(msg,color){
    if(typeof sendShowStatus==='function'){sendShowStatus(msg,color||'#f7931a');return;}
    var el=document.getElementById('send-status');
    if(el){el.innerHTML=msg;el.style.display='block';el.style.color=color||'#f7931a';}
  }

  if(!walletConnected()){
    showStatus('⚠️ Connect wallet first!','#ff4466');
    if(typeof openWalletModal==='function') openWalletModal();
    return;
  }

  var recipientEl=document.getElementById('send-recipient');
  var amountEl=document.getElementById('send-amount');
  var btn=document.getElementById('send-btn');
  var recipient=(recipientEl?.value||'').trim();
  var amountStr=(amountEl?.value||'').trim();
  var token=(typeof _sendSelectedToken!=='undefined')?_sendSelectedToken:'tBTC';
  var contract=REAL_CONTRACTS[token];

  if(!recipient){showStatus('⚠️ Enter recipient address!','#ff4466');return;}
  if(!isValidAddr(recipient)){showStatus('⚠️ Invalid testnet address (use tb1..., m/n, or opt1...)','#ff4466');return;}
  var amount=parseFloat(amountStr);
  if(!amount||isNaN(amount)||amount<=0){showStatus('⚠️ Enter a valid amount!','#ff4466');return;}

  var provObj=walletProvObj();
  var provType=walletType();
  if(!provObj){showStatus('❌ Wallet provider not found','#ff4466');return;}

  if(btn){btn.disabled=true;btn.textContent='⏳ Signing…';}
  showStatus('📝 Sign transaction in your wallet…','#f7931a');

  try {
    var txid;

    if(token==='tBTC') {
      var sats=Math.round(amount*1e8);
      if(sats<546){showStatus('⚠️ Minimum 546 sats (dust limit)','#ff4466');if(btn){btn.disabled=false;btn.textContent='📤 Send';}return;}

      if(provType==='opwallet'||provType==='unisat') {
        txid=await provObj.sendBitcoin(recipient,sats);
      } else if(provType==='okx') {
        var or=await window.okxwallet.bitcoin.sendBitcoin(recipient,sats);
        txid=or?.txhash||or;
      } else if(provType==='xverse') {
        txid=await new Promise((res,rej)=>provObj.sendBtcTransaction({
          payload:{network:{type:'Testnet'},recipients:[{address:recipient,amountSats:BigInt(sats)}],senderAddress:walletAddr()},
          onFinish:r=>res(r),onCancel:()=>rej(new Error('User cancelled'))
        }));
      } else {
        throw new Error('sendBitcoin not supported for: '+provType);
      }

    } else {
      if(!contract) throw new Error('No contract address for '+token);
      var dec=DECIMALS[token]||8;
      var calldata='0xa9059cbb'+addrCalldata(recipient)+amtHex32(amount,dec);

      if(provType==='opwallet'||provType==='unisat') {
        try {
          var tx1=await provObj.sendTransaction({to:contract,data:calldata,value:'0x0'});
          txid=tx1?.txid||tx1?.hash||tx1;
        } catch(e1) {
          try {
            var tx2=await provObj.contractCall({contractAddress:contract,data:calldata});
            txid=tx2?.txid||tx2?.hash||tx2;
          } catch(e2) {
            var tx3=await rpc('eth_sendTransaction',[{from:walletAddr(),to:contract,data:calldata}]);
            txid=tx3;
          }
        }
      } else if(provType==='okx') {
        var okxR=await (window.okxwallet.bitcoin.sendTransaction?.({to:contract,data:calldata})||window.okxwallet.bitcoin.contractCall?.({contractAddress:contract,data:calldata}));
        txid=okxR?.txid||okxR?.hash||okxR;
      } else {
        throw new Error('OP-20 transfer requires OP_WALLET or UniSat');
      }
    }

    if(!txid) throw new Error('No transaction ID returned');
    if(typeof txid==='object') txid=txid.txid||txid.hash||JSON.stringify(txid);
    txid=String(txid).replace('0x','');

    var explorerUrl='https://mempool.space/testnet4/tx/'+txid;
    showStatus('✅ Sent! TXID: '+txid.slice(0,16)+'… <a href="'+explorerUrl+'" target="_blank" style="color:#f7931a;text-decoration:underline">View →</a>','#00ff88');

    // Save TX
    var txEntry={hash:txid,type:'send',token:token,amount:amount,to:recipient,from:walletAddr(),timestamp:Date.now(),status:'pending'};
    if(typeof OPiLLStorage!=='undefined'&&OPiLLStorage.addTx) OPiLLStorage.addTx(txEntry);
    if(typeof Storage!=='undefined'&&Storage.addLocalTx) Storage.addLocalTx(txEntry);
    if(typeof _sendHistory!=='undefined'){
      var now=new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      _sendHistory.unshift({time:now,token:token,amount:amount,to:recipient,status:'confirmed',txid:txid});
      if(typeof sendRenderHistory==='function') sendRenderHistory();
    }

    setTimeout(function(){
      if(btn){btn.disabled=false;btn.textContent='📤 Send';}
      if(amountEl) amountEl.value='';
      if(recipientEl) recipientEl.value='';
    },3000);
    setTimeout(function(){if(walletConnected())syncSendBalances();},6000);

  } catch(err) {
    console.error('[sendSubmit]',err);
    var msg=err?.message||String(err);
    if(msg.includes('rejected')||msg.includes('cancel')||msg.includes('denied')) msg='Transaction rejected by user';
    else if(msg.includes('insufficient')||msg.includes('balance')) msg='Insufficient balance';
    showStatus('❌ '+msg,'#ff4466');
    if(btn){btn.disabled=false;btn.textContent='📤 Send';}
  }
};

// ─── Token Search OVERRIDE ─────────────────────────────────
var _patchDB=[
  {sym:'tBTC', name:'Bitcoin (testnet4)',      addr:'native',             icon:'₿', color:'#f7931a'},
  {sym:'OPILL',name:'OPILL Protocol Token',    addr:REAL_CONTRACTS.OPILL, icon:'💊',color:'#00e5ff'},
  {sym:'PILL', name:'PILL Token',              addr:REAL_CONTRACTS.PILL,  icon:'💉',color:'#ff8c00'},
  {sym:'MOTO', name:'MOTO Token',              addr:REAL_CONTRACTS.MOTO,  icon:'🏍️',color:'#f7931a'},
];

window.sendSearchToken=function(val){
  var results=document.getElementById('send-search-results');
  var clearBtn=document.getElementById('send-search-clear');
  if(!results)return;
  var q=(val||'').trim().toLowerCase();
  if(!q){results.style.display='none';if(clearBtn)clearBtn.style.display='none';return;}
  if(clearBtn)clearBtn.style.display='flex';

  var matches=_patchDB.filter(t=>t.sym.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)||t.addr.toLowerCase().includes(q));

  if(!matches.length&&(q.startsWith('0x')||q.length>30)){
    var ct=q.startsWith('0x')?q:('0x'+q);
    results.style.display='block';
    results.innerHTML='<div style="padding:12px 16px;font-size:11px;color:var(--text-muted)">🔍 Searching contract…</div>';
    (async()=>{
      try {
        var info=null;
        try{info=await restGet('/api/v1/token/'+ct);}catch{}
        if(!info?.symbol){
          try{
            var sr=await rpc('eth_call',[{to:ct,data:'0x95d89b41'},'latest']);
            var nr=await rpc('eth_call',[{to:ct,data:'0x06fdde03'},'latest']);
            var sym=decodeABIStr(sr),name=decodeABIStr(nr);
            if(sym) info={symbol:sym,name:name||sym};
          }catch{}
        }
        if(info?.symbol){
          var found={sym:info.symbol,name:info.name||info.symbol,addr:ct,icon:'🪙',color:'#aaa'};
          if(!_patchDB.find(t=>t.addr.toLowerCase()===ct.toLowerCase())) _patchDB.push(found);
          if(typeof _sendTokenList!=='undefined') _sendTokenList.push({sym:found.sym,name:found.name,addr:found.addr,icon:found.icon,color:found.color});
          renderTR(results,[found]);
        } else {
          results.innerHTML='<div style="padding:12px;color:var(--text-muted);text-align:center;font-size:11px">Contract not found on OP_NET testnet</div>';
        }
      }catch{results.innerHTML='<div style="padding:12px;color:var(--text-muted);text-align:center;font-size:11px">Search failed</div>';}
    })();
    return;
  }

  if(!matches.length){results.style.display='block';results.innerHTML='<div style="padding:14px 16px;font-size:12px;color:var(--text-muted);text-align:center">No token found for "'+val+'"</div>';return;}
  renderTR(results,matches);
};

function renderTR(container,tokens){
  container.style.display='block';
  container.innerHTML=tokens.map(t=>'<div onclick="sendPickSearchToken(\''+t.sym+'\')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s" onmouseover="this.style.background=\'rgba(247,147,26,0.08)\'" onmouseout="this.style.background=\'transparent\'">'
    +'<div style="font-size:20px;width:28px;text-align:center">'+t.icon+'</div>'
    +'<div style="flex:1;min-width:0">'
    +'<div style="font-family:Syne,sans-serif;font-weight:700;font-size:13px;color:'+t.color+'">'+t.sym+'</div>'
    +'<div style="font-size:10px;color:var(--text-muted);margin-top:1px">'+t.name+'</div>'
    +'<div style="font-size:9px;color:rgba(255,255,255,0.2);font-family:monospace;overflow:hidden;text-overflow:ellipsis">'+t.addr+'</div>'
    +'</div>'
    +'<div style="font-size:10px;color:var(--orange);font-weight:700;opacity:.7">SELECT →</div>'
    +'</div>').join('');
}

// ─── Auto sync on wallet connect & page load ─────────────
ready(function(){
  if(walletConnected()) setTimeout(syncSendBalances,1000);
  if(window.Wallet){
    if(typeof Wallet.onEvent==='function') Wallet.onEvent(e=>{ if(e==='connect') setTimeout(syncSendBalances,1200); });
    if(typeof Wallet.on==='function') Wallet.on('connect',()=>setTimeout(syncSendBalances,1200));
  }
});

console.log('[send_patch] ✅ Real TX engine loaded — sendSubmit() is live');
})();
