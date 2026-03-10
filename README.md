# OPILL Protocol — Bitcoin Testnet DeFi

A full DeFi interface for swapping, pooling, and faucet on **Bitcoin Testnet** via the **OPNet** protocol.

## Features
- **Wallet Connect** — UniSat, Xverse, OKX (auto-detects installed wallets)
- **Real balances** — BTC balance via mempool.space testnet API; OPNet token balances via `eth_call`
- **Swap** — Token swap UI with real price estimation and wallet confirmation
- **Pool** — Liquidity pool listing and add/remove flow
- **Faucet** — Claim testnet tokens (24h cooldown per token)
- **Transactions** — Real on-chain tx history linked to mempool.space testnet explorer
- **Live stats** — BTC price (CoinGecko), OPNet block number, gas price

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

### Environment Variables (Vercel dashboard)
| Variable | Description |
|---|---|
| `OPNET_RPC` | OPNet testnet RPC (default: `https://testnet.opnet.org`) |
| `FAUCET_PRIVATE_KEY` | WIF private key of faucet wallet (optional, enables real claims) |
| `OPILL_CONTRACT` | OPILL token contract address on testnet |
| `WBTC_CONTRACT` | WBTC contract address |
| `USDT_CONTRACT` | USDT contract address |
| `USDC_CONTRACT` | USDC contract address |
| `ORDI_CONTRACT` | ORDI contract address |

## Token Contracts
Update the contract addresses in `js/opnetTokens.js` once your tokens are deployed to OPNet testnet.

## Local Development
Simply open `index.html` in a browser (use a local HTTP server to avoid CORS):
```bash
npx serve .
# or
python3 -m http.server 3000
```

## Tech Stack
- Vanilla HTML/CSS/JS (no build step needed)
- OPNet JSON-RPC via `https://testnet.opnet.org`
- Bitcoin wallet: UniSat / Xverse / OKX browser extensions
- BTC price: CoinGecko free API + Binance fallback
- Transaction explorer: mempool.space testnet
- Deployment: Vercel (serverless API functions for faucet + price proxy)
