# NivGuard live demo on Arc testnet

An AI agent spending real money on a real chain, with a spending policy
enforced in front of it. Recorded run, Arc public testnet, 6 August 2026.

Every payment below was decided by a smart contract. No human approved any of
them. The agent signs its own transactions through a Circle custodial wallet
and holds no private key.

## What you are looking at

A business deposits USDC and registers an AI agent under a spending policy.
The policy has three limits and a kill switch:

| Limit | Value in this run |
| --- | --- |
| budget per period | 3 USDC per hour |
| maximum per transaction | 1 USDC |
| merchant allowlist | 1 merchant approved, 1 deliberately not |
| revocation | owner can cut the agent off in one transaction |

The agent then tries seven payments on its own. Three are inside the policy
and go through. Four are outside it and the contract rejects them, each for a
specific reason. Nothing is simulated and nothing is scripted to fail: the
agent attempts every payment for real, and the chain decides.

## Addresses

| What | Address |
| --- | --- |
| SpendFirewall contract | [`0x28412A523b9e1D13b1D108bF39Ab3A49035cd248`](https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248) |
| Agent, Circle custody, revoked in this run | [`0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4`](https://testnet.arcscan.app/address/0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4) |
| Owner, the business | [`0x684C426DD7c2652592cF85116702D50f3e326a95`](https://testnet.arcscan.app/address/0x684C426DD7c2652592cF85116702D50f3e326a95) |
| Merchant A, allowlisted | [`0x2f572D8771Af409Fce73970898974F7d94787386`](https://testnet.arcscan.app/address/0x2f572D8771Af409Fce73970898974F7d94787386) |
| Merchant B, not allowlisted | [`0x3994a61B70C84F18294316764ABFB73588C8763F`](https://testnet.arcscan.app/address/0x3994a61B70C84F18294316764ABFB73588C8763F) |
| USDC, ERC-20 interface | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

Network: Arc testnet, chain ID `5042002`, explorer https://testnet.arcscan.app

**The contract source is verified on the explorer**, so you can read exactly
what enforced these decisions without trusting this document:
https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248?tab=contract

The two merchants are dedicated demo addresses, derived deterministically as
the last 20 bytes of `keccak256("nivguard.demo.merchant.allowed")` and
`keccak256("nivguard.demo.merchant.blocked")`. Nobody holds a key for either,
which is the point: merchants only ever receive, they never sign.

## Result at a glance

| Payment | Attempt | Outcome | Why |
| --- | --- | --- | --- |
| 1 | 1 USDC to an approved vendor | **PASSED** | inside every limit |
| 2 | 1 USDC to an unknown vendor | **BLOCKED** | merchant not on the allowlist |
| 3 | 2 USDC to an approved vendor | **BLOCKED** | over the 1 USDC per-transaction cap |
| 4.1 | 1 USDC recurring top up | **PASSED** | inside every limit |
| 4.2 | 1 USDC recurring top up | **PASSED** | budget now exactly exhausted |
| 4.3 | 1 USDC once more | **BLOCKED** | no budget left this period |
| 5 | 0.5 USDC after the owner revoked | **BLOCKED** | agent revoked |

**3 allowed, 4 blocked, out of 7 attempts.**

Four distinct reason codes fired, one per blocked payment:

| Code | Name | Payment |
| --- | --- | --- |
| 0 | `OK` | 1, 4.1, 4.2 |
| 2 | `REVOKED` | 5 |
| 3 | `MERCHANT_NOT_ALLOWED` | 2 |
| 4 | `OVER_MAX_PER_TX` | 3 |
| 5 | `OVER_PERIOD_BUDGET` | 4.3 |

Codes 1 `NOT_REGISTERED`, 6 `INSUFFICIENT_BALANCE` and 7 `ZERO_AMOUNT` are
implemented and tested but do not fire in this run, because the agent is
registered, funded above its budget, and never asks for zero.

## Transactions

Only allowed payments produce a transaction. A blocked payment is rejected by
the contract, so no value moves and there is nothing to link. This is visible
on the explorer: the agent's address shows exactly three outgoing
transactions, nonces 0, 1 and 2, and all three succeeded. The four blocked
attempts never reached the chain, because Circle's gas estimation hit the
revert first and refused to broadcast.

### The agent's payments, signed by Circle custody

| Payment | Amount | Block | Transaction |
| --- | --- | --- | --- |
| 1 | 1 USDC | 55566085 | [`0x533815a6...ff5ae078`](https://testnet.arcscan.app/tx/0x533815a695c4c1e32a2603f27ddd5ca924c9d7618b5cc8b0d2dfae50ff5ae078) |
| 4.1 | 1 USDC | 55566242 | [`0xc2492791...c7f9b1ea`](https://testnet.arcscan.app/tx/0xc249279195f82cfb1cfb72fd6c5569c8d041dd458ce39d0756545d28c7f9b1ea) |
| 4.2 | 1 USDC | 55566280 | [`0x4d48341f...1420b045`](https://testnet.arcscan.app/tx/0x4d48341fba73452c11acab49e8235de1d278c104cc978d3bd81837df1420b045) |

### The owner's kill switch

| Action | Block | Transaction |
| --- | --- | --- |
| revokeAgent | 55566353 | [`0xf8df9edd...a11a8fe1`](https://testnet.arcscan.app/tx/0xf8df9eddd4f2d992a1e8be292dd41a2b2737ffa9bc22b20f7cc20d01a11a8fe1) |

### Setup, before the agent ran

| Step | Block | Transaction |
| --- | --- | --- |
| deploy SpendFirewall | 55416501 | [`0xada74c3a...0c7cd643d`](https://testnet.arcscan.app/tx/0xada74c3a640ea9112da7a1e426fd78b052ae3df8fb8146cf75f53440c7cd643d) |
| fund the agent with gas | 55565566 | [`0xc01b4d09...f95ea5d8a`](https://testnet.arcscan.app/tx/0xc01b4d0934ccb3e19e0d932dfc9a7885211fb437617932ed3975714f95ea5d8a) |
| registerAgent | 55565623 | [`0xca013179...b5ef8705e`](https://testnet.arcscan.app/tx/0xca013179ef12be32df1f023b82fdc9b0a0dfad124ec06b6c2133902b5ef8705e) |
| allowlist merchant A | 55565633 | [`0xad7ed481...289ca0989`](https://testnet.arcscan.app/tx/0xad7ed481a256eb00e2a801a84bc5086536c8ed3f9742a2d98f8540d289ca0989) |
| approve USDC | 55565661 | [`0x5d1addde...762fc24e`](https://testnet.arcscan.app/tx/0x5d1addde89ebec12855a395cace2cd246f13ac9877a9c307e49a6b7d762fc24e) |
| deposit 5 USDC | 55565679 | [`0xbf0c16b4...092adc21`](https://testnet.arcscan.app/tx/0xbf0c16b45d8df9c0fefe141394ef67cb82e1709b9e57a1c132a3f4d4092adc21) |

The contract itself was deployed on 5 August and is reused across runs, which
is why its block number is far below the rest.

The agent's wallet is created empty. On Arc the gas token is USDC, so it
needs a gas balance before it can broadcast anything at all. That is the
second transaction above: the owner sends it 0.5 USDC, which at the gas
prices this testnet quotes covers well over a hundred transactions. The agent
never receives spending money this way. Everything it can spend sits inside
the firewall under a policy, which is the whole point.

## Independent verification

Read straight off the chain after the run, not from the program's own output.

```
agent               0x0ffbcf5360e32Ef47217f2437e6B4f649017abA4
registered          true
agent revoked       true
period spent        3 USDC
remaining           0 USDC
balance in firewall 2 USDC
outgoing tx count   3

SpendAuthorized events for this agent: 3, totalling exactly 3 USDC
merchant B (blocked) ERC-20 USDC: 0
```

The three `SpendAuthorized` events for this agent total exactly 3 USDC, the
three allowed payments and nothing else. Merchant B, the target of the blocked
payment, received **nothing at all** and its balance is still zero. The agent
still has 2 USDC sitting in the firewall that it can no longer touch, because
the owner revoked it.

Merchant A's own balance is higher than 3 USDC, because it is a fixed address
reused by every demo run and holds the total of all of them. The per-agent
event total above is the figure that isolates this run.

### The audit trail, queried from the contract

```
events for this agent, since setup:

  55565623  AgentRegistered      0xca013179ef12be32df1f023b82fdc9b0a0dfad124ec06b6c2133902b5ef8705e
  55565633  MerchantAllowlisted  0xad7ed481a256eb00e2a801a84bc5086536c8ed3f9742a2d98f8540d289ca0989
  55565679  Deposited            0xbf0c16b45d8df9c0fefe141394ef67cb82e1709b9e57a1c132a3f4d4092adc21   5 USDC
  55566085  SpendAuthorized      0x533815a695c4c1e32a2603f27ddd5ca924c9d7618b5cc8b0d2dfae50ff5ae078   1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  55566242  SpendAuthorized      0xc249279195f82cfb1cfb72fd6c5569c8d041dd458ce39d0756545d28c7f9b1ea   1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  55566280  SpendAuthorized      0x4d48341fba73452c11acab49e8235de1d278c104cc978d3bd81837df1420b045   1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  55566353  AgentRevoked         0xf8df9eddd4f2d992a1e8be292dd41a2b2737ffa9bc22b20f7cc20d01a11a8fe1
```

Three spends authorised, matching the three payments that passed. The four
blocked payments emitted nothing, because they never happened.

## Full console output, verbatim

Colour escape codes stripped, otherwise unedited.

```

> nivguard@1.0.0 demo:arc
> node agent/demo.js --network arcTestnet


====================================================================
  NivGuard: onchain spend firewall for AI agents
====================================================================
  network    arcTestnet  (chainId 5042002)
  firewall   0x28412A523b9e1D13b1D108bF39Ab3A49035cd248
  agent      0x0ffbcf5360e32ef47217f2437e6b4f649017aba4
  wallet     Circle developer-controlled wallet

  policy     3 USDC per 3600s period
             1 USDC maximum per transaction
             1 merchant allowlisted, 1 deliberately not
  funded     5 USDC

  The agent decides on its own. No human approves any payment below.

--------------------------------------------------------------------
  PAYMENT 1  GPU compute from an approved vendor
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0x533815a695c4c1e32a2603f27ddd5ca924c9d7618b5cc8b0d2dfae50ff5ae078
  budget     1 / 3 USDC used, 2 left this period

--------------------------------------------------------------------
  PAYMENT 2  an unknown vendor the agent found on its own
--------------------------------------------------------------------
  merchant   0x3994a61B70C84F18294316764ABFB73588C8763F  (NOT allowlisted)
  amount     1 USDC
  dry run    BLOCKED  MERCHANT_NOT_ALLOWED  (code 3, merchant is not on the allowlist)
  submit     spend() via Circle developer-controlled wallet
  result     BLOCKED  rejected by the firewall
  reason     MerchantNotAllowed: merchant 0x3994a61B70C84F18294316764ABFB73588C8763F is not on the allowlist
  budget     1 / 3 USDC used, 2 left this period

--------------------------------------------------------------------
  PAYMENT 3  approved vendor, but an oversized invoice
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     2 USDC
  dry run    BLOCKED  OVER_MAX_PER_TX  (code 4, amount is over the per transaction cap)
  submit     spend() via Circle developer-controlled wallet
  result     BLOCKED  rejected by the firewall
  reason     ExceedsMaxPerTx: amount 2 USDC is over the per transaction cap of 1 USDC
  budget     1 / 3 USDC used, 2 left this period

====================================================================
  PAYMENT 4: spending until the period budget runs out
====================================================================

--------------------------------------------------------------------
  PAYMENT 4.1  recurring top up, inside every cap
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0xc249279195f82cfb1cfb72fd6c5569c8d041dd458ce39d0756545d28c7f9b1ea
  budget     2 / 3 USDC used, 1 left this period

--------------------------------------------------------------------
  PAYMENT 4.2  recurring top up, inside every cap
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0x4d48341fba73452c11acab49e8235de1d278c104cc978d3bd81837df1420b045
  budget     3 / 3 USDC used, 0 left this period

--------------------------------------------------------------------
  PAYMENT 4.3  one more after the period budget is gone
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     1 USDC
  dry run    BLOCKED  OVER_PERIOD_BUDGET  (code 5, amount would exceed the period budget)
  submit     spend() via Circle developer-controlled wallet
  result     BLOCKED  rejected by the firewall
  reason     ExceedsPeriodBudget: amount 1 USDC exceeds the 0 USDC left in this period
  budget     3 / 3 USDC used, 0 left this period

====================================================================
  PAYMENT 5: the owner pulls the kill switch
====================================================================

  owner      0x684C426DD7c2652592cF85116702D50f3e326a95  (PRIVATE_KEY)
  action     revokeAgent(0x0ffbcf5360e32ef47217f2437e6b4f649017aba4)
  tx         0xf8df9eddd4f2d992a1e8be292dd41a2b2737ffa9bc22b20f7cc20d01a11a8fe1
  Revocation is one transaction and takes effect immediately.

--------------------------------------------------------------------
  PAYMENT 5  the agent tries to pay after being revoked
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     0.5 USDC
  dry run    BLOCKED  REVOKED  (code 2, agent has been revoked by the owner)
  submit     spend() via Circle developer-controlled wallet
  result     BLOCKED  rejected by the firewall
  reason     AgentIsRevoked: agent has been revoked by the owner
  policy     agent is revoked, no further spending possible

====================================================================
  Summary
====================================================================
  PASSED   PAYMENT 1   
  BLOCKED  PAYMENT 2     MERCHANT_NOT_ALLOWED
  BLOCKED  PAYMENT 3     OVER_MAX_PER_TX
  PASSED   PAYMENT 4.1 
  PASSED   PAYMENT 4.2 
  BLOCKED  PAYMENT 4.3   OVER_PERIOD_BUDGET
  BLOCKED  PAYMENT 5     REVOKED

  3 allowed and 4 blocked out of 7 attempts.

  Every one of those decisions was made by the contract, not by the
  agent, and every one is an indexed event onchain.

```

## Preflight, run immediately before the demo

```
====================================================================
  NivGuard preflight: arcTestnet
====================================================================

   PASS   PRIVATE_KEY               0x684C426DD7c2652592cF85116702D50f3e326a95
   PASS   CIRCLE_API_KEY            set
   PASS   CIRCLE_ENTITY_SECRET      set
   PASS   agent wallet              0x0ffbcf5360e32ef47217f2437e6b4f649017aba4
   PASS   deployment record         deployments/arcTestnet.json
   PASS   rpc                       https://rpc.testnet.arc.network  chainId 5042002
   PASS   contract deployed         0x28412A523b9e1D13b1D108bF39Ab3A49035cd248
   PASS   owner key                 0x684C426DD7c2652592cF85116702D50f3e326a95  (PRIVATE_KEY)
   PASS   owner gas                 18.4048926063 USDC (gas)
   PASS   agent matches record      env and deployment record agree
   PASS   agent gas                 0.5 USDC (gas)
   PASS   agent registered          3 USDC per 3600s, max 1 per tx
   PASS   agent deposit             5 USDC in the firewall
   PASS   merchants                 1 allowlisted, 1 deliberately not

  Ready. All checks passed.
```

`agent matches record` was added after an earlier run failed: preflight used to
print the agent from `.env` while checking the one in the deployment record, so
a freshly provisioned wallet that had never been registered still passed every
check against the previous agent. The run then died at `revokeAgent` with
`AgentNotRegistered`. Preflight now checks the wallet the demo actually signs
as, and fails when the two disagree.

## The live dashboard shows a different agent

This run ends with its agent revoked, which is the point of it: the kill switch
works and is permanent. A revoked agent makes for a dead dashboard, though,
where every panel reads "revoked" and nothing can be explored.

So the public dashboard is pointed at **agent B**,
[`0xC2540BD8052aaD62a600994f376CaDEC524e9c2C`](https://testnet.arcscan.app/address/0xC2540BD8052aaD62a600994f376CaDEC524e9c2C),
a second agent registered under the identical policy against the same contract,
allowlisted to the same merchant, funded, and deliberately left active. It is
labelled as such in the UI. This run's revocation lives here, in this document,
and in the video.

Both agents are on the same SpendFirewall contract, so the dashboard's
contract address matches every transaction linked above.

## Notes for a reader who has not seen the code

**The agent holds no private key.** Its wallet is a Circle
developer-controlled wallet. The agent asks Circle to execute `spend()` and
Circle signs and broadcasts it. There is no key material in this repository.
The line `spend() via Circle developer-controlled wallet` in the output above
is the custody path in action.

**The dry run and the real attempt are separate.** Before each payment the
agent calls `checkSpend()`, a read-only function that returns whether the
payment would be allowed and a numeric reason code. It then submits the real
transaction regardless of what the dry run said, because the contract is the
authority and the prediction is not. In this run the two agreed every time.
`checkSpend()` is what lets a dashboard show a user *why* something would be
blocked before it is attempted.

**Being blocked is normal, not a crash.** The agent decodes the contract's
custom error, logs the reason in plain English, and moves on to the next job.

**On Arc, USDC is also the gas token.** It appears in two views of the same
funds: 18 decimals for gas, 6 decimals for transfers and balances. Every
policy amount here is the 6 decimal view. The two differ by a factor of
10^12, so mixing them would be a million-million-fold error.

## Reproducing this

```bash
npm install
npx hardhat compile

npm run deploy:arc      # deploy the firewall, or reuse an existing one
npm run provision       # create the Circle agent wallet
npm run fund:agent      # send it gas, since a new wallet is empty
npm run setup:arc       # register the agent, allowlist, deposit
npm run preflight:arc   # verify everything before running
npm run demo:arc        # the run above
```

Requires a Circle API key, a registered Circle entity secret, and a funded Arc
testnet key. Testnet USDC comes from https://faucet.circle.com. The owner needs
about 5.5 USDC on hand per run: 5 to deposit and 0.5 to fund the agent's gas.

Each recorded run ends with its agent revoked and cannot be repeated with the
same wallet. Provision a fresh one for the next run.

The same sequence runs offline against a local hardhat node with
`npm run demo`, which uses a local signer instead of Circle.
