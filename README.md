# NivGuard

**An onchain spend firewall for AI agents, built on Arc.**

[![live dashboard](https://img.shields.io/badge/live%20dashboard-nivguard.netlify.app-2ea44f)](https://nivguard.netlify.app)
[![mirror](https://img.shields.io/badge/mirror-GitHub%20Pages-6e7781)](https://ueddy.github.io/nivguard/)
[![v1 verified](https://img.shields.io/badge/v1%20verified-0x28412A5-1f6feb)](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract)
[![v2 verified](https://img.shields.io/badge/v2%20verified-0xBB7c199-8250df)](https://testnet.arcscan.app/address/0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b?tab=contract)
[![demo video](https://img.shields.io/badge/demo%20video-v1-red)](https://drive.google.com/file/d/1TKzJTF6pL1BpeV_BjHKI5-Ev_WM4kxNg/view)

| | |
| --- | --- |
| Live dashboard | **https://nivguard.netlify.app** |
| Mirror | https://ueddy.github.io/nivguard/ |
| Demo video | https://drive.google.com/file/d/1TKzJTF6pL1BpeV_BjHKI5-Ev_WM4kxNg/view |

## Two deployments, and which one the video shows

There are two verified contracts on Arc testnet. They are separate deployments,
not an upgrade: v1 was never migrated, repointed, or replaced.

| | v1, the recorded submission demo | v2, Gateway funding added |
| --- | --- | --- |
| Address | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract) | [`0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b`](https://testnet.arcscan.app/address/0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b?tab=contract) |
| Source verified | yes | yes |
| **In the demo video** | **yes, this is the one on screen** | **no** |
| In [docs/DEMO-OUTPUT.md](docs/DEMO-OUTPUT.md) | yes | no |
| On the live dashboard | yes | no |
| Policy engine | budget, allowlist, per-tx cap, revoke | identical |
| `spend()` to merchants | yes | yes |
| `fundGateway()` for nanopayments | no | yes |
| Write-up | this page, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/NANOPAYMENTS.md](docs/NANOPAYMENTS.md) |

**Everything under "Proof it works" and everything on the dashboard is v1.** The
video shows v1. v2 adds one function to the same policy engine and is proven by
its own separate run, recorded in [docs/NANOPAYMENTS.md](docs/NANOPAYMENTS.md).

## What it does

A business deposits USDC and registers an AI agent under a spending policy: a
budget per period, a merchant allowlist, and a ceiling on any single payment.
The agent then spends on its own, with no human approving individual payments,
and the contract enforces the policy on every transfer. Anything outside the
policy reverts, the owner can revoke the agent in one transaction, and every
decision is an indexed event onchain.

## Proof it works

This is the v1 run, on contract
[`0x28412A5`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract),
and it is the run in the demo video.

A recorded run on Arc public testnet, 6 August 2026. The agent attempted seven
payments. The contract allowed three and rejected four, each for a specific
reason. Nothing was scripted to fail: the agent submitted every payment for
real and the chain decided.

Policy in force: 3 USDC per hour, 1 USDC maximum per transaction, one merchant
allowlisted and one deliberately not.

| # | Attempted | Outcome | Reason | Transaction |
| --- | --- | --- | --- | --- |
| 1 | 1 USDC to the allowlisted merchant | **allowed** | code 0, inside every limit | [`0x533815a6...0ff5ae078`](https://testnet.arcscan.app/tx/0x533815a695c4c1e32a2603f27ddd5ca924c9d7618b5cc8b0d2dfae50ff5ae078) |
| 2 | 1 USDC to a merchant it found on its own | **blocked** | code 3, `MERCHANT_NOT_ALLOWED` | none, never broadcast |
| 3 | 2 USDC to the allowlisted merchant | **blocked** | code 4, `OVER_MAX_PER_TX` | none, never broadcast |
| 4.1 | 1 USDC to the allowlisted merchant | **allowed** | code 0, inside every limit | [`0xc2492791...8c7f9b1ea`](https://testnet.arcscan.app/tx/0xc249279195f82cfb1cfb72fd6c5569c8d041dd458ce39d0756545d28c7f9b1ea) |
| 4.2 | 1 USDC to the allowlisted merchant | **allowed** | code 0, budget now exhausted | [`0x4d48341f...f1420b045`](https://testnet.arcscan.app/tx/0x4d48341fba73452c11acab49e8235de1d278c104cc978d3bd81837df1420b045) |
| 4.3 | 1 USDC to the allowlisted merchant | **blocked** | code 5, `OVER_PERIOD_BUDGET` | none, never broadcast |
| 5 | 0.5 USDC after the owner revoked the agent | **blocked** | code 2, `REVOKED` | none, never broadcast |

Three allowed, four blocked, out of seven attempts. The owner's kill switch
between 4.3 and 5 is
[`0xf8df9edd...1a11a8fe1`](https://testnet.arcscan.app/tx/0xf8df9eddd4f2d992a1e8be292dd41a2b2737ffa9bc22b20f7cc20d01a11a8fe1).

**The blocked payments never reached the chain.** They have no transaction hash
because there is no transaction to link. The agent submitted each one through
its Circle wallet, and Circle's gas estimation hit the contract's revert and
refused to broadcast. The revert is the whole mechanism, so being stopped at
estimation is the firewall working.

Two facts on the chain confirm it, and both are permanent:

- The demo agent
  [`0x0ffbcf53...9017abA4`](https://testnet.arcscan.app/address/0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4)
  has a nonce of 3. Three outgoing transactions in its entire existence, matching
  the three allowed payments exactly.
- The non-allowlisted merchant
  [`0x3994a61B...88C8763F`](https://testnet.arcscan.app/address/0x3994a61B70C84F18294316764ABFB73588C8763F)
  holds 0 USDC. It was the target of payment 2 and never received anything.

The full run, verbatim console output and independent onchain verification, is
in [docs/DEMO-OUTPUT.md](docs/DEMO-OUTPUT.md).

## Try it yourself

**https://nivguard.netlify.app**

The dashboard reads the firewall live from Arc testnet: the agent's policy and
remaining budget, the merchant allowlist, and an activity feed built from
onchain events. It is pointed at v1, the same contract as the video.

The policy simulator is the part worth three minutes of a judge's time. Type any
merchant address and any amount and it calls `checkSpend()` on the deployed
contract, returning the real allow or block decision and the reason code against
current onchain state. Change the amount to 2 USDC and watch it return
`OVER_MAX_PER_TX`. Point it at the blocked merchant and watch it return
`MERCHANT_NOT_ALLOWED`. No wallet connection, no transaction, nothing spent, and
the answer comes from the contract rather than from JavaScript imitating it.

The dashboard is pointed at a second agent, agent B, registered under the
identical policy on the same contract and deliberately left active. The agent
from the recorded run above ends it revoked, which is the point of the kill
switch, and a revoked agent makes for a dashboard where nothing can be explored.
The page says which agent it is showing.

## How it works

The policy lives onchain, in front of the money. The agent never holds the
funds; it holds permission, and permission is revocable.

| | |
| --- | --- |
| Budget per period | Total spend allowed in one window, which resets on fixed windows anchored to registration |
| Merchant allowlist | The set of addresses this agent may pay, per agent |
| Max per transaction | Ceiling on any single payment |
| Instant revoke | One owner transaction, effective in the same block, and the agent is cut off permanently |
| Onchain audit trail | `SpendAuthorized`, `AgentRevoked`, `AgentRegistered` and the rest, all indexed by agent |

`spend()` and `checkSpend()` share one internal evaluation function, so the dry
run the dashboard shows can never disagree with what the chain enforces. A test
asserts that across every path. 87 tests pass, covering both v1's `spend()` and
v2's `fundGateway()`.

Depth, including the reason codes, the period rollover rule, gas costs and the
Arc decimal hazard, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Circle and Arc stack

Proven, not aspirational. The first four are visible in the v1 run above; the
last is v2 and is proven by its own run in
[docs/NANOPAYMENTS.md](docs/NANOPAYMENTS.md).

- **Arc public testnet**, chain ID `5042002`, with **USDC as the native gas
  token**. Every transaction linked on this page is on Arc. USDC appears in two
  views over the same funds, 18 decimals for gas and 6 decimals for transfers;
  all policy math is the 6 decimal view.
- **Circle developer-controlled wallets** for agent custody. The agent's wallet
  is created and signed by Circle through
  `createContractExecutionTransaction`. The three allowed payments in the v1 run
  were signed by Circle, and that path stores no agent key. See the note below
  on where v2 does need one.
- **Blockscout JSON-RPC** at `https://testnet.arcscan.app/api/eth-rpc` for the
  browser client. Arc's public RPC sends no `access-control-allow-origin` header
  and has no `OPTIONS` handler, so a browser cannot call it; Blockscout answers
  the same `eth_call` and `eth_getLogs` with permissive CORS. Node-side scripts
  use the direct Arc RPC.
- **Circle faucet** for testnet USDC.
- **Circle Nanopayments and Circle Gateway** in v2 only, through
  `@circle-fin/x402-batching`. The firewall funds an agent's Gateway balance
  with `GatewayWallet.depositFor`, and the agent pays x402 resources out of it.
  See [Nanopayments](#nanopayments-v2-only) below.

Not used: CCTP and Paymaster are not wired into this project and are not
claimed. The owner side signs with a local key via Hardhat and ethers; only the
agent is under Circle custody, which is the part that matters, since the agent is
the untrusted spender.

### Where a private key does exist, and why

v1 stores no agent key at all. Every agent payment in the recorded run was
signed by Circle.

v2 needs one, and the reason is a hard constraint rather than a shortcut.
Nanopayment authorizations are offchain EIP-3009 signatures, and Circle's
batching SDK signs them with a raw private key: `GatewayClient` takes a
`privateKey` and exposes no custom signer hook. A Circle developer-controlled
wallet never releases a key, so **Circle custody cannot sign EIP-3009
authorizations.** The two halves of v2 are therefore signed by two different
things:

| | signs | Circle custody can do it? |
| --- | --- | --- |
| `fundGateway()`, the gated onchain top up | ordinary contract call | yes |
| the nanopayments that follow | offchain EIP-712 typed data | no, needs a raw key |

So `AGENT_GATEWAY_PRIVATE_KEY` exists in v2. What bounds it is the firewall:
that key only ever controls funds the firewall has already released into the
Gateway pool under policy. The treasury stays behind the firewall under Circle
custody. Losing the hot key costs one top up, not the balance sheet, and the
owner can revoke the agent so no further top up ever lands. That is the blast
radius the firewall exists to bound, and it is worth stating rather than
implying the key is not there.

This project was built using Circle Skills in Claude Code, which is part of Agent
Stack. That is development tooling, not a runtime dependency; nothing in the
deployed system calls it.

## Run it locally

Needs Node 18 or newer, a Circle API key, a registered Circle entity secret, and
an Arc testnet key funded from https://faucet.circle.com.

```bash
npm install
cp .env.example .env     # fill in PRIVATE_KEY, CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET
npx hardhat compile
npx hardhat test         # 87 tests, no network needed

npm run deploy:arc       # deploy the firewall
npm run provision        # create the Circle agent wallet
npm run fund:agent       # send it gas, since a new Circle wallet is empty
npm run setup:arc        # register the agent, allowlist a merchant, deposit
npm run preflight:arc    # check every precondition before a recorded run
npm run demo:arc         # the seven payment run above
npm run sync:dashboard   # rewrite the dashboard addresses from the deployment
npm run web              # serve the dashboard at http://localhost:8080
```

The same narrative runs offline against a local Hardhat node with `npm run
demo`, which substitutes a local signer for Circle and needs no API key.

Those commands reproduce the v1 run on a fresh contract of your own. They do not
touch the deployed v1 at `0x28412A5`. For the v2 nanopayments run:

```bash
npm run nano:key -- --write   # generate the agent's nanopayment hot key
npm run nano:setup            # deploy v2, wire up Gateway, register, fund
npm run nano:demo             # starts the x402 seller in-process and runs
```

Re-running `nano:demo` inside the same hour shows the top ups blocked on budget,
which is correct rather than broken. A fresh policy window needs an hour or
another `npm run nano:setup`.

## Nanopayments, v2 only

On v2 at
[`0xBB7c199`](https://testnet.arcscan.app/address/0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b?tab=contract)
the firewall also gates the one onchain step in Circle Nanopayments: the Gateway
deposit. `fundGateway()` runs the same evaluation function as `spend()`, against
the same period budget and per-transaction cap, so an agent's nanopayment float
can only be filled through the firewall. The GatewayWallet has to be allowlisted
like any other merchant, so this is opt in per agent, and revoking an agent cuts
off its top ups for free.

Nanopayments themselves are offchain EIP-3009 authorizations that Circle batches
and settles, so there is no onchain call to gate and this does not pretend
otherwise. **The firewall bounds the pool, not the drops.**

A recorded Arc testnet run, separate from the v1 video:

| step | outcome |
| --- | --- |
| TOP UP 1, 0.2 USDC | allowed |
| 6 nanopayments | all settled, 0.0001 to 0.0025 USDC each |
| TOP UP 2, 0.2 USDC | allowed |
| TOP UP 3, 0.2 USDC | **blocked**, `OVER_PERIOD_BUDGET`, no funds moved |
| 6 nanopayments | all settled |

Two gated onchain top ups moving 0.4 USDC authorised 12 ungated offchain
nanopayments moving 0.007 USDC, and would have authorised thousands. Two
`GatewayFunded` events are onchain, matching the two allowed top ups.

### The caveat, stated plainly

Once funds are in the Gateway balance the **agent** is the depositor, so it can
also withdraw them to its own address, bypassing the merchant allowlist
entirely. The firewall cannot stop that, and nothing here claims it can.

Two things bound it, neither of which is prevention:

- Gateway withdrawals are two step with a delay in blocks
  (`initiateWithdrawal`, then `withdraw`), and the initiation is an onchain
  event, so an operator watching the chain sees it coming and can revoke before
  the next top up.
- The amount at risk is only what the firewall already released under policy,
  never the treasury behind it.

This is why the pool should be sized as a float, not a balance sheet. The
guarantee v2 makes is about the rate and total volume of funds entering the
pool, not about where each nanopayment goes.

Full write-up, including the two Circle SDK gotchas that cost real time, is in
[docs/NANOPAYMENTS.md](docs/NANOPAYMENTS.md).

## Deployed addresses

Arc testnet, chain ID `5042002`, explorer https://testnet.arcscan.app

**v1, the recorded submission demo.** This is what the video and the dashboard
show.

| What | Address |
| --- | --- |
| SpendFirewall v1, verified source | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract) |
| Agent, Circle custody, revoked in the recorded run | [`0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4`](https://testnet.arcscan.app/address/0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4) |
| Agent B, Circle custody, live on the dashboard | [`0xC2540BD8052aaD62a600994f376CaDEC524e9c2C`](https://testnet.arcscan.app/address/0xC2540BD8052aaD62a600994f376CaDEC524e9c2C) |

**v2, Gateway funding.** Not in the video, not on the dashboard.

| What | Address |
| --- | --- |
| SpendFirewall v2, verified source | [`0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b`](https://testnet.arcscan.app/address/0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b?tab=contract) |
| Agent, nanopayment hot key, holds the Gateway pool | [`0x0A19cf8a11a3e43D7Ab88Dd528a796E31C5bb571`](https://testnet.arcscan.app/address/0x0A19cf8a11a3e43D7Ab88Dd528a796E31C5bb571) |
| Circle GatewayWallet, allowlisted as the top up destination | [`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) |

**Shared by both.**

| What | Address |
| --- | --- |
| Merchant, allowlisted | [`0x2f572D8771Af409Fce73970898974F7d94787386`](https://testnet.arcscan.app/address/0x2f572D8771Af409Fce73970898974F7d94787386) |
| Merchant, not allowlisted | [`0x3994a61B70C84F18294316764ABFB73588C8763F`](https://testnet.arcscan.app/address/0x3994a61B70C84F18294316764ABFB73588C8763F) |
| Owner, the business | [`0x684C426DD7c2652592cF85116702D50f3e326a95`](https://testnet.arcscan.app/address/0x684C426DD7c2652592cF85116702D50f3e326a95) |
| USDC, ERC-20 interface | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

Both merchant addresses are derived deterministically as the last 20 bytes of
`keccak256("nivguard.demo.merchant.allowed")` and
`keccak256("nivguard.demo.merchant.blocked")`. Nobody holds a key for either,
which is the point: merchants only ever receive, they never sign.

---

Encode Club, Build on Arc. Agentic Economy track. MIT licensed.
