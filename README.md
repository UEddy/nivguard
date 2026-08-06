# NivGuard

**An onchain spend firewall for AI agents, built on Arc.**

[![live dashboard](https://img.shields.io/badge/live%20dashboard-nivguard.netlify.app-2ea44f)](https://nivguard.netlify.app)
[![mirror](https://img.shields.io/badge/mirror-GitHub%20Pages-6e7781)](https://ueddy.github.io/nivguard/)
[![verified contract](https://img.shields.io/badge/verified%20contract-testnet.arcscan.app-1f6feb)](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract)
[![demo video](https://img.shields.io/badge/demo%20video-watch-red)](REPLACE_WITH_VIDEO_URL)

<!-- Demo video: replace both occurrences of REPLACE_WITH_VIDEO_URL below and above. -->

| | |
| --- | --- |
| Live dashboard | **https://nivguard.netlify.app** |
| Mirror | https://ueddy.github.io/nivguard/ |
| Verified contract | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract) on Arc testnet |
| Demo video | REPLACE_WITH_VIDEO_URL |

## What it does

A business deposits USDC and registers an AI agent under a spending policy: a
budget per period, a merchant allowlist, and a ceiling on any single payment.
The agent then spends on its own, with no human approving individual payments,
and the contract enforces the policy on every transfer. Anything outside the
policy reverts, the owner can revoke the agent in one transaction, and every
decision is an indexed event onchain.

## Proof it works

A recorded run on Arc public testnet, 5 August 2026. The agent attempted seven
payments. The contract allowed three and rejected four, each for a specific
reason. Nothing was scripted to fail: the agent submitted every payment for
real and the chain decided.

Policy in force: 3 USDC per hour, 1 USDC maximum per transaction, one merchant
allowlisted and one deliberately not.

| # | Attempted | Outcome | Reason | Transaction |
| --- | --- | --- | --- | --- |
| 1 | 1 USDC to the allowlisted merchant | **allowed** | code 0, inside every limit | [`0x794252e4...fff8889d9`](https://testnet.arcscan.app/tx/0x794252e48bf66431626e5e103cb1a4fb7d9cb0e290dc430d9c06d92fff8889d9) |
| 2 | 1 USDC to a merchant it found on its own | **blocked** | code 3, `MERCHANT_NOT_ALLOWED` | none, never broadcast |
| 3 | 2 USDC to the allowlisted merchant | **blocked** | code 4, `OVER_MAX_PER_TX` | none, never broadcast |
| 4.1 | 1 USDC to the allowlisted merchant | **allowed** | code 0, inside every limit | [`0x79dd03b7...9bf6e3e1b`](https://testnet.arcscan.app/tx/0x79dd03b717d38c373001ebcb60843461d27f5133602ea8c854b10c39bf6e3e1b) |
| 4.2 | 1 USDC to the allowlisted merchant | **allowed** | code 0, budget now exhausted | [`0xcc11bb0a...ecf6bfec9`](https://testnet.arcscan.app/tx/0xcc11bb0abe37fc19d8c525300ec7ef4592c9cab3487d9c115d474c8ecf6bfec9) |
| 4.3 | 1 USDC to the allowlisted merchant | **blocked** | code 5, `OVER_PERIOD_BUDGET` | none, never broadcast |
| 5 | 0.5 USDC after the owner revoked the agent | **blocked** | code 2, `REVOKED` | none, never broadcast |

Three allowed, four blocked, out of seven attempts. The owner's kill switch
between 4.3 and 5 is
[`0xe023817f...b58e58a4`](https://testnet.arcscan.app/tx/0xe023817f9efc415b2577ab8816f2575d81a3733f7473243eb91e0b20b58e58a4).

**The blocked payments never reached the chain.** They have no transaction hash
because there is no transaction to link. The agent submitted each one through
its Circle wallet, and Circle's gas estimation hit the contract's revert and
refused to broadcast. The revert is the whole mechanism, so being stopped at
estimation is the firewall working.

Two facts on the chain confirm it, and both are permanent:

- The demo agent
  [`0xa2429471...ccF7BCd1`](https://testnet.arcscan.app/address/0xa2429471b76C16135CEeb05b89e86dD2ccF7BCd1)
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
onchain events.

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
asserts that across every path. 58 tests pass.

Depth, including the reason codes, the period rollover rule, gas costs and the
Arc decimal hazard, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Circle and Arc stack

Proven, and visible in the run above:

- **Arc public testnet**, chain ID `5042002`, with **USDC as the native gas
  token**. Every transaction linked on this page is on Arc. USDC appears in two
  views over the same funds, 18 decimals for gas and 6 decimals for transfers;
  all policy math is the 6 decimal view.
- **Circle developer-controlled wallets** for agent custody. The agent's wallet
  is created and signed by Circle through
  `createContractExecutionTransaction`. There is no private key for the agent
  anywhere in this repository. The three allowed payments were signed by Circle.
- **Blockscout JSON-RPC** at `https://testnet.arcscan.app/api/eth-rpc` for the
  browser client. Arc's public RPC sends no `access-control-allow-origin` header
  and has no `OPTIONS` handler, so a browser cannot call it; Blockscout answers
  the same `eth_call` and `eth_getLogs` with permissive CORS. Node-side scripts
  use the direct Arc RPC.
- **Circle faucet** for testnet USDC.

Not used: Circle Nanopayments, Gateway, CCTP, and Paymaster are not wired into
this project and are not claimed. The owner side signs with a local key via
Hardhat and ethers; only the agent is under Circle custody, which is the part
that matters, since the agent is the untrusted spender.

## Run it locally

Needs Node 18 or newer, a Circle API key, a registered Circle entity secret, and
an Arc testnet key funded from https://faucet.circle.com.

```bash
npm install
cp .env.example .env     # fill in PRIVATE_KEY, CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET
npx hardhat compile
npx hardhat test         # 58 tests, no network needed

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

## Deployed addresses

Arc testnet, chain ID `5042002`, explorer https://testnet.arcscan.app

| What | Address |
| --- | --- |
| SpendFirewall, verified source | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract) |
| Agent A, Circle custody, revoked in the recorded run | [`0xa2429471b76C16135CEeb05b89e86dD2ccF7BCd1`](https://testnet.arcscan.app/address/0xa2429471b76C16135CEeb05b89e86dD2ccF7BCd1) |
| Agent B, Circle custody, live on the dashboard | [`0xC2540BD8052aaD62a600994f376CaDEC524e9c2C`](https://testnet.arcscan.app/address/0xC2540BD8052aaD62a600994f376CaDEC524e9c2C) |
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
