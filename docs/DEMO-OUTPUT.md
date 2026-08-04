# NivGuard live demo on Arc testnet

An AI agent spending real money on a real chain, with a spending policy
enforced in front of it. Recorded run, Arc public testnet, 4 August 2026.

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
| SpendFirewall contract | [`0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec`](https://testnet.arcscan.app/address/0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec) |
| Agent wallet, Circle custody | [`0x92B0757acA6192c38fb972ffca6a97d984D3Bc9f`](https://testnet.arcscan.app/address/0x92B0757acA6192c38fb972ffca6a97d984D3Bc9f) |
| Owner, the business | [`0x684C426DD7c2652592cF85116702D50f3e326a95`](https://testnet.arcscan.app/address/0x684C426DD7c2652592cF85116702D50f3e326a95) |
| Merchant A, allowlisted | [`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`](https://testnet.arcscan.app/address/0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) |
| Merchant B, not allowlisted | [`0x90F79bf6EB2c4f870365E785982E1f101E93b906`](https://testnet.arcscan.app/address/0x90F79bf6EB2c4f870365E785982E1f101E93b906) |
| USDC, ERC-20 interface | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

Network: Arc testnet, chain ID `5042002`, explorer https://testnet.arcscan.app

**The contract source is verified on the explorer**, so you can read exactly
what enforced these decisions without trusting this document:
https://testnet.arcscan.app/address/0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec#code

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
the contract, so no value moves and there is nothing to link.

### The agent's payments, signed by Circle custody

| Payment | Amount | Transaction |
| --- | --- | --- |
| 1 | 1 USDC | [`0xde2416e6...bba967e`](https://testnet.arcscan.app/tx/0xde2416e68f4b1060200db018c450a249247305e908635342b79ab1debbba967e) |
| 4.1 | 1 USDC | [`0x3baa83ea...cf751712`](https://testnet.arcscan.app/tx/0x3baa83ea43e82e808782a73564d84cf7a2af65bac142f0961a2b6e4fcf751712) |
| 4.2 | 1 USDC | [`0x1de51b90...c94ee5024`](https://testnet.arcscan.app/tx/0x1de51b90a365538a072ae94fba9da160c842493cc68de60bf60b1d7c94ee5024) |

### The owner's kill switch

| Action | Transaction |
| --- | --- |
| revokeAgent | [`0xaa15eb02...ea9e17d6`](https://testnet.arcscan.app/tx/0xaa15eb02a72b3817e99c626617e537281eef28126c34fed3c09a01a8ea9e17d6) |

### Setup, before the agent ran

| Step | Transaction |
| --- | --- |
| deploy SpendFirewall | [`0x8e2261b4...3088ffc6`](https://testnet.arcscan.app/tx/0x8e2261b4c2117e4a4065ee93b6803d7a625e5710c9e85f44b37566e83088ffc6) |
| registerAgent | [`0x5b13f405...c243b757`](https://testnet.arcscan.app/tx/0x5b13f4054dfe3350b4b798c8d4ff473e0494224ebca38cd81a086533c243b757) |
| updatePolicy | [`0x1966d1d9...d6d5afc5`](https://testnet.arcscan.app/tx/0x1966d1d94cd9711169c9e240c48633e2341e9778e4c615218633cb3bd6d5afc5) |
| allowlist merchant A | [`0xdc3e0600...41e9a369`](https://testnet.arcscan.app/tx/0xdc3e0600237a4eeb512a2950c393c19f6b4f59ba73463864e5178d3941e9a369) |
| approve USDC | [`0x76c5dc4b...db086c0c`](https://testnet.arcscan.app/tx/0x76c5dc4b82b33b71f3c1b8ff38c2ff593aaeb6d64a53172ca1005651db086c0c) |
| deposit 5 USDC | [`0xb1fd369c...1d037dbe`](https://testnet.arcscan.app/tx/0xb1fd369c6ebd143c388164ea610416a9644bfb03300305385fc0f6a21d037dbe) |

## Independent verification

Read straight off the chain after the run, not from the program's own output.

```
merchant A (allowlisted) ERC-20 USDC: 3.03696
merchant B (blocked)     ERC-20 USDC: 0.0

agent revoked       true
period spent        3.0 USDC
remaining           0.0 USDC
balance in firewall 2.0 USDC
```

Merchant A received exactly the 3 USDC of allowed payments. Merchant B, the
target of the blocked payment, received **nothing at all**. The agent still
has 2 USDC sitting in the firewall that it can no longer touch, because the
owner revoked it.

Merchant A's balance shows slightly more than 3 USDC because it is a well
known public test address that other people on this testnet also use. The
3 USDC from this run is accounted for by the events below.

### The audit trail, queried from the contract

```
SpendAuthorized     3
    block 55239667  1.0 USDC -> 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
    block 55239739  1.0 USDC -> 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
    block 55239747  1.0 USDC -> 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
AgentRegistered     1   block 55239029
PolicyUpdated       1   block 55239298
MerchantAllowlisted 1   block 55239305
Deposited           1   block 55239390
AgentRevoked        1   block 55239768
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
  firewall   0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec
  agent      0x92b0757aca6192c38fb972ffca6a97d984d3bc9f
  wallet     Circle developer-controlled wallet

  policy     3 USDC per 3600s period
             1 USDC maximum per transaction
             1 merchant allowlisted, 1 deliberately not
  funded     5 USDC

  The agent decides on its own. No human approves any payment below.

--------------------------------------------------------------------
  PAYMENT 1  GPU compute from an approved vendor
--------------------------------------------------------------------
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0xde2416e68f4b1060200db018c450a249247305e908635342b79ab1debbba967e
  budget     1 / 3 USDC used, 2 left this period

--------------------------------------------------------------------
  PAYMENT 2  an unknown vendor the agent found on its own
--------------------------------------------------------------------
  merchant   0x90F79bf6EB2c4f870365E785982E1f101E93b906  (NOT allowlisted)
  amount     1 USDC
  dry run    BLOCKED  MERCHANT_NOT_ALLOWED  (code 3, merchant is not on the allowlist)
  submit     spend() via Circle developer-controlled wallet
  result     BLOCKED  rejected by the firewall
  reason     MerchantNotAllowed: merchant 0x90F79bf6EB2c4f870365E785982E1f101E93b906 is not on the allowlist
  budget     1 / 3 USDC used, 2 left this period

--------------------------------------------------------------------
  PAYMENT 3  approved vendor, but an oversized invoice
--------------------------------------------------------------------
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
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
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0x3baa83ea43e82e808782a73564d84cf7a2af65bac142f0961a2b6e4fcf751712
  budget     2 / 3 USDC used, 1 left this period

--------------------------------------------------------------------
  PAYMENT 4.2  recurring top up, inside every cap
--------------------------------------------------------------------
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
  amount     1 USDC
  dry run    ALLOWED  checkSpend says yes  (code 0)
  submit     spend() via Circle developer-controlled wallet
  result     PASSED   tx 0x1de51b90a365538a072ae94fba9da160c842493cc68de60bf60b1d7c94ee5024
  budget     3 / 3 USDC used, 0 left this period

--------------------------------------------------------------------
  PAYMENT 4.3  one more after the period budget is gone
--------------------------------------------------------------------
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
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
  action     revokeAgent(0x92b0757aca6192c38fb972ffca6a97d984d3bc9f)
  tx         0xaa15eb02a72b3817e99c626617e537281eef28126c34fed3c09a01a8ea9e17d6
  Revocation is one transaction and takes effect immediately.

--------------------------------------------------------------------
  PAYMENT 5  the agent tries to pay after being revoked
--------------------------------------------------------------------
  merchant   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (allowlisted)
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
   PASS   agent wallet              0x92b0757aca6192c38fb972ffca6a97d984d3bc9f
   PASS   deployment record         deployments/arcTestnet.json
   PASS   rpc                       https://rpc.testnet.arc.network  chainId 5042002
   PASS   contract deployed         0x4851d5E24BAaA13d40f5E59D3Ee26d72a05ac4Ec
   PASS   owner key                 0x684C426DD7c2652592cF85116702D50f3e326a95  (PRIVATE_KEY)
   PASS   owner gas                 14.960170562 USDC (gas)
   PASS   agent gas                 20.0 USDC (gas)
   PASS   agent registered          3 USDC per 3600s, max 1 per tx
   PASS   agent deposit             5 USDC in the firewall
   PASS   merchants                 1 allowlisted, 1 deliberately not

  Ready. All checks passed.
```

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
npm run setup:arc       # register the agent, allowlist, deposit
npm run preflight:arc   # verify everything before running
npm run demo:arc        # the run above
```

Requires a Circle API key, a registered Circle entity secret, and a funded Arc
testnet key. Testnet USDC comes from https://faucet.circle.com.

The same sequence runs offline against a local hardhat node with
`npm run demo`, which uses a local signer instead of Circle.
