# Funding nanopayments through the firewall

This branch extends NivGuard so an agent's Circle Gateway balance can only be
filled by the firewall, under the same policy that governs its merchant
payments.

Status: working end to end on Arc testnet against the real Circle Gateway.

## The constraint that shapes everything

Nanopayment authorizations are signed offchain and settled in batches. That is
not an implementation detail, it is the mechanism:

- The buyer signs an EIP-3009 `TransferWithAuthorization` against the
  `GatewayWalletBatched` EIP-712 domain and puts it in a `PAYMENT-SIGNATURE`
  header. No transaction, no gas.
- Circle verifies it, collects many such authorizations, and settles the net
  positions in one onchain transaction, paying gas once per batch instead of
  once per payment.
- Funds come from a Gateway balance that was deposited onchain, once.

So an individual nanopayment **cannot** be gated by an onchain contract call.
There is no call to gate. A signature made on the agent's own machine is not
something a `require()` can sit in front of.

Sources: [x402 concepts](https://developers.circle.com/gateway/nanopayments/concepts/x402),
[circlefin/arc-nanopayments](https://github.com/circlefin/arc-nanopayments),
[circlefin/evm-gateway-contracts](https://github.com/circlefin/evm-gateway-contracts).

## What the firewall can therefore control

The deposit, which is the only onchain step. `fundGateway` makes that step pass
the same policy as `spend`:

```
fundGateway()   onchain    gated      one transaction per top up
gateway.pay()   offchain   ungated    thousands per top up
```

The firewall controls the tap, not each drop. Stated precisely:

- Every USDC that reaches the Gateway pool passed a policy check, was charged
  against the same period budget as merchant payments, and left an indexed
  `GatewayFunded` event onchain.
- The individual nanopayments were not checked and could not be.

That is a real guarantee and worth not overclaiming. An agent whose top ups are
cut off keeps whatever is already in its pool. What it loses is the ability to
get more, which is the thing a budget is actually for.

### What an agent can still do with a funded pool

Once funds are in the Gateway balance the **agent** is the depositor, so it can
also withdraw them to its own address, bypassing the merchant allowlist. Two
things bound that:

- Gateway withdrawals are two step with a delay in blocks
  (`initiateWithdrawal`, then `withdraw`), and the initiation is an onchain
  event, so an operator watching the chain sees it coming.
- The amount at risk is only what the firewall already released under policy,
  never the treasury behind it.

This is why the pool should be sized as a float, not a balance sheet.

## `depositFor` is what makes this possible

A plain `GatewayWallet.deposit(token, value)` credits `msg.sender`. If the
firewall called that, the Gateway balance would belong to the firewall, and the
firewall has no private key, so it could never sign the offchain authorizations
that nanopayments are made of. The funds would be stuck.

`depositFor(token, depositor, value)` pulls the USDC from the firewall but
credits the balance to the agent. The agent signs against a pool it never
custodied.

## Design decisions

**The GatewayWallet is allowlisted like any other merchant.** `fundGateway`
runs `_evaluate(agent, gatewayWallet, amount)`, the same function `spend` uses.
So gateway funding is opt in per agent: an operator who never calls
`setMerchantAllowed(agent, gatewayWallet, true)` has an agent that can pay
merchants but can never open a nanopayment pool. Revoking an agent kills its
top ups along with its spending, for free.

**One budget, two doors.** Merchant payments and gateway top ups share
`periodSpent`, so an agent cannot get twice its cap by taking 3 USDC of
merchant payments and then another 3 USDC into the pool. Total outflow is what
the policy caps, whichever door it leaves by.

**A distinct event.** `GatewayFunded` rather than a flag on `SpendAuthorized`.
A `SpendAuthorized` means money reached a named merchant and the story ends
there. A `GatewayFunded` means money entered a pool the contract can no longer
see, whose individual payments will never appear onchain one by one. An auditor
needs to tell those apart.

**`setGatewayWallet` rather than a constructor argument.** The address is a
Circle deployment that differs per chain and does not exist on a local hardhat
node. Zero means gateway funding is switched off and `fundGateway` reverts with
`GatewayNotConfigured` rather than burning budget.

**`fundGateway(agent, amount)` checks the caller.** The `agent` parameter is not
an authorisation. Without the check, anyone could push another agent's funds
into the gateway and burn its budget. Caller must be the agent or the owner.

## Two integration facts that cost real time

**1. The SDK's facilitator defaults to mainnet.** `new BatchFacilitatorClient()`
points at `https://gateway-api.circle.com`, which serves 11 mainnet chains and
no testnets. A seller that leaves the default in place will advertise Arc
testnet in its 402, take a perfectly valid signature, and reject it with
`unsupported_network`. The error names the network, which sends you looking at
your own CAIP-2 string rather than at the endpoint. Arc testnet
(`eip155:5042002`) is served by `https://gateway-api-testnet.circle.com`.

**2. `maxTimeoutSeconds` is not a free choice.** The facilitator advertises
`minValiditySeconds` per network, 604800 (seven days) on Arc testnet, and
rejects anything shorter. Circle's own sample uses 345600, which is below it.

**3. Circle custody cannot sign nanopayments.** `GatewayClient` takes a raw
`privateKey` and exposes no custom signer hook, while a Circle
developer-controlled wallet never releases a key. So the two halves are signed
by two different things:

| | signs | can Circle custody do it? |
|---|---|---|
| `fundGateway()` | ordinary onchain call | yes |
| nanopayment authorization | offchain EIP-712 | no, needs a raw key |

The split is defensible on its own terms. The hot key only ever controls what
the firewall already released under policy; the treasury stays behind the
firewall with Circle custody. Losing the hot key costs one top up, and the
owner can revoke the agent so no further top up ever lands. But it is a
property of Circle's SDK, not a choice, and it should be stated rather than
glossed.

## Recorded run

Arc testnet, firewall `0xBB7c199A21763426F2B259042d7DD8F2Ccb59c1b`,
agent `0x0A19cf8a11a3e43D7Ab88Dd528a796E31C5bb571`,
policy 0.5 USDC per hour, max 0.2 USDC per top up.

| step | outcome |
|---|---|
| TOP UP 1, 0.2 USDC | ALLOWED, pool +0.2 |
| 6 nanopayments | all settled, 0.0035 USDC |
| TOP UP 2, 0.2 USDC | ALLOWED, pool +0.2 |
| TOP UP 3, 0.2 USDC | BLOCKED, `OVER_PERIOD_BUDGET`, no funds moved |
| 6 nanopayments | all settled, 0.0035 USDC |

Totals: 2 gated onchain top ups moving 0.4 USDC, 12 ungated offchain
nanopayments moving 0.007 USDC, 0.1 USDC of budget left unspent.

Two `GatewayFunded` events onchain, matching the two allowed top ups:

```
block 55935661  0.2 USDC  periodSpent 0.2  left 0.3  tx 0x2f15d5e4...
block 55935714  0.2 USDC  periodSpent 0.4  left 0.1  tx 0x973fd2c3...
```

The ratio is the point: two gated transactions authorised 12 payments, and
would have authorised thousands. Individual nanopayments ranged from 0.0001 to
0.0025 USDC, well below what a transaction per payment could ever justify.

## Running it

```bash
npm run nano:key -- --write     # generate the agent's nanopayment key
npm run nano:setup              # deploy, wire up Gateway, register, fund
npm run nano:demo               # starts the seller in-process and runs
```

`npm run nano:seller` runs the x402 seller on its own if you want to watch
settlements land while driving the agent by hand.

Re-running the demo inside the same hour will show the top ups blocked on
budget, which is correct rather than broken. A fresh policy window needs either
an hour or another `npm run nano:setup`.

## Files

| file | role |
|---|---|
| `contracts/SpendFirewall.sol` | `fundGateway`, `checkFundGateway`, `setGatewayWallet`, `GatewayFunded` |
| `contracts/interfaces/IGatewayWallet.sol` | the slice of Circle's GatewayWallet used |
| `contracts/test/MockGatewayWallet.sol` | models the caller/depositor split for tests |
| `agent/gateway.js` | the seam between gated onchain and ungated offchain |
| `agent/nanoAgent.js` | the agent: `topUp()` and `buy()` |
| `agent/nanoDemo.js` | the demo sequence |
| `scripts/nanoSeller.js` | minimal x402 seller, sub-cent prices |
| `scripts/setupNano.js` | owner-side setup on Arc |
| `scripts/newNanoAgent.js` | generates the nanopayment signing key |
