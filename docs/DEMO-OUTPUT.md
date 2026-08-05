# NivGuard live demo on Arc testnet

An AI agent spending real money on a real chain, with a spending policy
enforced in front of it. Recorded run, Arc public testnet, 5 August 2026.

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
| Agent A, Circle custody, revoked in this run | [`0xa2429471b76C16135CEeb05b89e86dD2ccF7BCd1`](https://testnet.arcscan.app/address/0xa2429471b76C16135CEeb05b89e86dD2ccF7BCd1) |
| Owner, the business | [`0x684C426DD7c2652592cF85116702D50f3e326a95`](https://testnet.arcscan.app/address/0x684C426DD7c2652592cF85116702D50f3e326a95) |
| Merchant A, allowlisted | [`0x2f572D8771Af409Fce73970898974F7d94787386`](https://testnet.arcscan.app/address/0x2f572D8771Af409Fce73970898974F7d94787386) |
| Merchant B, not allowlisted | [`0x3994a61B70C84F18294316764ABFB73588C8763F`](https://testnet.arcscan.app/address/0x3994a61B70C84F18294316764ABFB73588C8763F) |
| USDC, ERC-20 interface | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

Network: Arc testnet, chain ID `5042002`, explorer https://testnet.arcscan.app

**The contract source is verified on the explorer**, so you can read exactly
what enforced these decisions without trusting this document:
https://testnet.arcscan.app/address/0x28412A523b9e1D13b1D108bF39Ab3A49035cd248#code

The two merchants are dedicated demo addresses, derived deterministically as
the last 20 bytes of `keccak256("nivguard.demo.merchant.allowed")` and
`keccak256("nivguard.demo.merchant.blocked")`. Nobody holds a key for either,
which is the point: merchants only ever receive, they never sign. Their
balances therefore show exactly what this run paid them and nothing else.

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
| 1 | 1 USDC | 55416769 | [`0x794252e4...fff8889d9`](https://testnet.arcscan.app/tx/0x794252e48bf66431626e5e103cb1a4fb7d9cb0e290dc430d9c06d92fff8889d9) |
| 4.1 | 1 USDC | 55416792 | [`0x79dd03b7...9bf6e3e1b`](https://testnet.arcscan.app/tx/0x79dd03b717d38c373001ebcb60843461d27f5133602ea8c854b10c39bf6e3e1b) |
| 4.2 | 1 USDC | 55416801 | [`0xcc11bb0a...ecf6bfec9`](https://testnet.arcscan.app/tx/0xcc11bb0abe37fc19d8c525300ec7ef4592c9cab3487d9c115d474c8ecf6bfec9) |

### The owner's kill switch

| Action | Block | Transaction |
| --- | --- | --- |
| revokeAgent | 55416824 | [`0xe023817f...b58e58a4`](https://testnet.arcscan.app/tx/0xe023817f9efc415b2577ab8816f2575d81a3733f7473243eb91e0b20b58e58a4) |

### Setup, before the agent ran

| Step | Block | Transaction |
| --- | --- | --- |
| deploy SpendFirewall | 55416501 | [`0xada74c3a...0c7cd643d`](https://testnet.arcscan.app/tx/0xada74c3a640ea9112da7a1e426fd78b052ae3df8fb8146cf75f53440c7cd643d) |
| fund the agent with gas | 55416608 | [`0x53b91091...533fe76d7`](https://testnet.arcscan.app/tx/0x53b91091b8f09b6cf0bffef164f5f614b7dc041541c672fa90f486f533fe76d7) |
| registerAgent | 55416646 | [`0xb60229ee...77f52a315`](https://testnet.arcscan.app/tx/0xb60229eef16ee4c25bea869bdd84642b093d19a50c5ea2a3d9c0bab77f52a315) |
| allowlist merchant A | 55416651 | [`0xc7c3816c...99f76b9e3b`](https://testnet.arcscan.app/tx/0xc7c3816ce27823b94e038351512597bcfecb1f4ea659becafd10a999f76b9e3b) |
| approve USDC | 55416659 | [`0x41def395...5022ab8e5c`](https://testnet.arcscan.app/tx/0x41def3950dff9a4bdb11529c085f760e821bf6300d13130c3b8e495022ab8e5c) |
| deposit 5 USDC | 55416668 | [`0x98da9c63...1ad3b06cad`](https://testnet.arcscan.app/tx/0x98da9c6394b9ee003348747ce0ef4cf70bc6951368111189924d921ad3b06cad) |

The agent's wallet is created empty. On Arc the gas token is USDC, so it
needs a gas balance before it can broadcast anything at all. That is the
second transaction above: the owner sends it 0.5 USDC, which at the gas
prices this testnet quotes covers well over a hundred transactions. The agent
never receives spending money this way. Everything it can spend sits inside
the firewall under a policy, which is the whole point.

## Independent verification

Read straight off the chain after the run, not from the program's own output.

```
merchant A (allowlisted) ERC-20 USDC: 3
merchant B (blocked)     ERC-20 USDC: 0

agent               0xa2429471b76c16135ceeb05b89e86dd2ccf7bcd1
registered          true
agent revoked       true
period spent        3 USDC
remaining           0 USDC
balance in firewall 2 USDC
```

Merchant A received exactly 3 USDC, the three allowed payments and nothing
else. Merchant B, the target of the blocked payment, received **nothing at
all**. The agent still has 2 USDC sitting in the firewall that it can no
longer touch, because the owner revoked it.

### The audit trail, queried from the contract

```
events on the firewall since deployment:
  OwnershipTransferred 1
  AgentRegistered      1
  MerchantAllowlisted  1
  Deposited            1
  SpendAuthorized      3
  AgentRevoked         1

  OwnershipTransferred block 55416501
  AgentRegistered      block 55416646
  MerchantAllowlisted  block 55416651
  Deposited            block 55416668
  SpendAuthorized      block 55416769  1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  SpendAuthorized      block 55416792  1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  SpendAuthorized      block 55416801  1 USDC -> 0x2f572D8771Af409Fce73970898974F7d94787386
  AgentRevoked         block 55416824
```

Three spends authorised, matching the three payments that passed. The four
blocked payments emitted nothing, because they never happened.

## Full console output, verbatim

```

> nivguard@1.0.0 demo:arc
> node agent/demo.js --network arcTestnet


====================================================================
  NivGuard: onchain spend firewall for AI agents
====================================================================
  network    arcTestnet  (chainId 5042002)
  firewall   0x28412A523b9e1D13b1D108bF39Ab3A49035cd248
  agent      0xa2429471b76c16135ceeb05b89e86dd2ccf7bcd1
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
  result     PASSED   tx 0x794252e48bf66431626e5e103cb1a4fb7d9cb0e290dc430d9c06d92fff8889d9
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
  result     PASSED   tx 0x79dd03b717d38c373001ebcb60843461d27f5133602ea8c854b10c39bf6e3e1b
  budget     2 / 3 USDC used, 1 left this period

--------------------------------------------------------------------
  PAYMENT 4.2  recurring top up, inside every cap
--------------------------------------------------------------------
  merchant   0x2f572D8771Af409Fce73970898974F7d94787386  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0xcc11bb0abe37fc19d8c525300ec7ef4592c9cab3487d9c115d474c8ecf6bfec9
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
  action     revokeAgent(0xa2429471b76c16135ceeb05b89e86dd2ccf7bcd1)
  tx         0xe023817f9efc415b2577ab8816f2575d81a3733f7473243eb91e0b20b58e58a4
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
   PASS   agent wallet              0xa2429471b76c16135ceeb05b89e86dd2ccf7bcd1
   PASS   deployment record         deployments/arcTestnet.json
   PASS   rpc                       https://rpc.testnet.arc.network  chainId 5042002
   PASS   contract deployed         0x28412A523b9e1D13b1D108bF39Ab3A49035cd248
   PASS   owner key                 0x684C426DD7c2652592cF85116702D50f3e326a95  (PRIVATE_KEY)
   PASS   owner gas                 9.4179637873 USDC (gas)
   PASS   agent gas                 0.5 USDC (gas)
   PASS   agent registered          3 USDC per 3600s, max 1 per tx
   PASS   agent deposit             5 USDC in the firewall
   PASS   merchants                 1 allowlisted, 1 deliberately not

  Ready. All checks passed.
```

## The live dashboard shows a different agent

This run ends with agent A revoked, which is the point of it: the kill switch
works and is permanent. A revoked agent makes for a dead dashboard, though,
where every panel reads "revoked" and nothing can be explored.

So the public dashboard is pointed at **agent B**, a second agent registered
under the identical policy against the same contract, allowlisted to the same
merchant, funded, and deliberately left active. It is labelled as such in the
UI. Agent A's revocation lives here, in this document, and in the video.

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

npm run deploy:arc      # deploy the firewall
npm run provision       # create the Circle agent wallet
npm run fund:agent      # send it gas, since a new wallet is empty
npm run setup:arc       # register the agent, allowlist, deposit
npm run preflight:arc   # verify everything before running
npm run demo:arc        # the run above
```

Requires a Circle API key, a registered Circle entity secret, and a funded Arc
testnet key. Testnet USDC comes from https://faucet.circle.com.

The same sequence runs offline against a local hardhat node with
`npm run demo`, which uses a local signer instead of Circle.
