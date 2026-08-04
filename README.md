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

An operator console that reads the firewall live from Arc testnet: the agent's
policy and remaining budget, the merchant allowlist, an activity feed built
from onchain events, and a policy simulator that calls `checkSpend()` so you
can test the firewall yourself without a wallet and without spending anything.

```bash
npm run web     # then open http://localhost:8080
```

Single self-contained file at `web/index.html`. No build step, no framework.
It is read only and never asks for a wallet connection.

## Live on Arc testnet

| | |
| --- | --- |
| SpendFirewall | [`0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec`](https://testnet.arcscan.app/address/0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec#code) |
| Agent wallet | Circle developer-controlled, no private key in this repo |

A full recorded run with every transaction hash is in
[docs/DEMO-OUTPUT.md](docs/DEMO-OUTPUT.md).

## Status

Contract complete and deployed to Arc testnet with 58 passing tests. Agent
runner and dashboard working end to end.
