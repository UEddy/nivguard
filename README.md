# NivGuard

An onchain spend firewall for AI agents, built on Arc.

## What it does

A business deposits USDC and registers an AI agent under a spending policy
covering budget per period, a merchant allowlist, and a maximum per
transaction. The agent spends autonomously inside that policy. Anything
outside it is blocked at the contract level. The owner can revoke access
instantly, and every spend is logged onchain as an audit trail.

## Hackathon

Encode Club, Build on Arc. Agentic Economy track.

Final submission 9 August 2026.

## Dashboard

**https://nivguard.netlify.app**

Live, no install, no wallet needed. Mirror:
[ueddy.github.io/nivguard](https://ueddy.github.io/nivguard/), the same file
served from GitHub Pages.

An operator console that reads the firewall live from Arc testnet: the agent's
policy and remaining budget, the merchant allowlist, an activity feed built
from onchain events, and a policy simulator that calls `checkSpend()` so you
can test the firewall yourself without a wallet and without spending anything.

Single self-contained file at `web/index.html`. No build step, no framework.
It is read only and never asks for a wallet connection. To run it locally
instead:

```bash
npm run web     # then open http://localhost:8080
```

## Live on Arc testnet

| | |
| --- | --- |
| SpendFirewall | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248#code) |
| Agent wallet | Circle developer-controlled, no private key in this repo |

A full recorded run with every transaction hash is in
[docs/DEMO-OUTPUT.md](docs/DEMO-OUTPUT.md).

Two agents run against that one contract. The recorded demo ends by revoking
its agent, which is the point of the kill switch, so the dashboard is pointed
at a second agent under the identical policy that is deliberately left active.
The page says which one it is showing.

## Status

Contract complete and deployed to Arc testnet with 58 passing tests. Agent
runner and dashboard working end to end.
