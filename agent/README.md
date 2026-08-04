# NivGuard agent runner

The autonomous side of NivGuard. This is the agent that actually spends money,
and the demo that shows the firewall stopping it when it tries to spend money
it should not.

## What the agent does

For every payment it wants to make, the agent:

1. Calls `checkSpend()` on SpendFirewall to dry-run the policy, and logs the
   decision plus the reason code.
2. Submits the real `spend()` transaction through its wallet, whatever the dry
   run said. The contract is the authority, not the prediction.
3. If the firewall rejects it, decodes the custom error, logs why in plain
   English, and continues to the next job.

A blocked payment is normal operation, not an outage. The runner never crashes
on one.

## Two signing backends

The runner is signer agnostic. The decision loop is identical either way.

| Network | Backend | Custody |
| --- | --- | --- |
| `arcTestnet` | Circle developer-controlled wallet | Circle holds the key |
| `localhost` | unlocked hardhat account | demo only |

**Circle cannot sign against a local hardhat node.** Circle broadcasts from its
own infrastructure and has no route to `127.0.0.1`. That is why the local demo
uses a hardhat account. It is demo scaffolding, not the custody story. The
Circle path is the real one and it runs on Arc testnet.

There is no private key in this repo, and none is ever written to disk. On Arc
the agent holds a custodial wallet at Circle and asks Circle to execute
`spend()` on its behalf.

## Running the local demo

Requires Node 18 or newer. From the repo root:

```bash
npm install
npx hardhat compile
```

Then, in one terminal:

```bash
npx hardhat node
```

And in another:

```bash
node agent/demo.js
```

That is the whole demo. It redeploys a fresh firewall each run, so you can run
it repeatedly and get the same sequence every time, which matters when you are
recording it.

The sequence:

| | Attempt | Outcome |
| --- | --- | --- |
| 1 | allowlisted merchant, inside every cap | PASSES |
| 2 | merchant not on the allowlist | BLOCKED, `MerchantNotAllowed` |
| 3 | allowlisted merchant, over the per-tx cap | BLOCKED, `ExceedsMaxPerTx` |
| 4 | repeat until the period budget is gone, then one more | BLOCKED, `ExceedsPeriodBudget` |
| 5 | owner revokes, agent tries again | BLOCKED, `AgentIsRevoked` |

To reuse an existing deployment instead of redeploying:

```bash
NIVGUARD_NO_SETUP=1 node agent/demo.js
```

To set up the local chain without running the demo:

```bash
node agent/setupLocal.js
```

## Setting up the Circle wallet for Arc

This is the production path. Do it once.

### 1. Get a Circle API key

From the Circle developer console. It looks like `PREFIX:ID:SECRET`.

### 2. Generate and register your entity secret

You must do this yourself. This script will not do it for you, and neither
will I: the entity secret is the thing that authorises spending from your
wallets, and the recovery file is the only way back if you lose it.

Follow Circle's entity secret registration flow, store the secret, and keep
the recovery file somewhere safe and offline.

### 3. Fill in .env

```
CIRCLE_API_KEY=your-key
CIRCLE_ENTITY_SECRET=your-32-byte-hex-secret
```

`.env` is gitignored. Do not commit it.

### 4. Provision the agent wallet

```bash
node agent/provision.js
```

This creates a wallet set and one EOA wallet on `ARC-TESTNET`, then writes
`CIRCLE_WALLET_SET_ID`, `AGENT_WALLET_ID` and `AGENT_WALLET_ADDRESS` back into
`.env`. Running it twice reuses the existing wallet set.

### 5. Fund and register the agent

Fund two addresses from https://faucet.circle.com. On Arc, USDC is also the
gas token, so an agent with no USDC cannot transact at all.

| Address | Needs | Why |
| --- | --- | --- |
| owner (your `PRIVATE_KEY`) | about 6 USDC | 5 to deposit, the rest for gas |
| agent (from `provision.js`) | about 1 USDC | gas only, it spends from the firewall |

Then register the agent and allowlist merchants:

```bash
npm run deploy:arc
npm run setup:arc
```

`setup:arc` registers the Circle wallet under the demo policy, allowlists one
merchant, deliberately leaves another off, deposits USDC, and writes
`deployments/arcTestnet.json` in the same shape the local demo uses. It is
safe to re-run: an already registered agent has its policy updated instead.

Override the demo merchants with `MERCHANT_ALLOWED` and `MERCHANT_BLOCKED`.

### 5b. Preflight

```bash
npm run preflight:arc
```

Checks keys, funding on both addresses, contract deployment, agent
registration, deposit and the merchant allowlist. It names whatever is missing
and exits non-zero, so you find out before the camera is rolling rather than
four payments in.

### 6. Run against Arc

```bash
node agent/demo.js --network arcTestnet
```

Use the `--network` flag rather than an environment variable prefix, since
PowerShell has no inline `VAR=x cmd` form.

## Demo amounts

Every number the demo uses lives in one file, `agent/demoConfig.js`. The local
demo and the Arc demo both read it, so they cannot drift apart.

The defaults are sized for testnet faucet reality, single digit USDC:

| | |
| --- | --- |
| budget per period | 3 USDC per hour |
| max per transaction | 1 USDC |
| deposited to the agent | 5 USDC |
| payment 3 asks for | 2 USDC, over the cap |

Three payments of 1 USDC exhaust the budget exactly, which is what makes the
period limit visible. `demoConfig.js` self-checks on load and throws if an
edit breaks the shape of the demo, for example a `maxPerTx` that payment 3 no
longer exceeds.

## Amounts and decimals

On Arc, USDC is the native gas token viewed at 18 decimals, while the USDC
ERC-20 interface is 6 decimals. The two differ by a factor of 10^12.

Every amount in this runner is the 6 decimal ERC-20 view: policy limits,
payment amounts, balances, logs. The runner does no gas math at all, so the 18
decimal view never appears. Mixing them would be a 10^12 error.

## Reason codes

`checkSpend()` returns these. They are also what the dashboard will render.

| Code | Meaning |
| --- | --- |
| 0 | allowed |
| 1 | agent not registered |
| 2 | agent revoked |
| 3 | merchant not on the allowlist |
| 4 | over the per transaction cap |
| 5 | over the period budget |
| 6 | insufficient balance |
| 7 | zero amount |

## Files

```
agent/
  demo.js              the scripted five payment sequence
  runner.js            the agent loop, signer agnostic
  setupLocal.js        deploys and configures the local chain
  provision.js         creates the Circle wallet, writes .env
  revert.js            decodes custom errors into readable reasons
  config.js            chain config, reason codes, artifact loading
  log.js               console formatting
  signers/
    index.js           picks a backend by network
    circleSigner.js    Circle developer-controlled wallets
    localSigner.js     unlocked hardhat account, demo only
```

## Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `CIRCLE_API_KEY` | Arc | from the Circle console |
| `CIRCLE_ENTITY_SECRET` | Arc | you generate and register it |
| `CIRCLE_WALLET_SET_ID` | Arc | written by `provision.js` |
| `AGENT_WALLET_ID` | Arc | written by `provision.js` |
| `AGENT_WALLET_ADDRESS` | Arc | written by `provision.js` |
| `NIVGUARD_NETWORK` | both | `localhost` or `arcTestnet` |
| `NIVGUARD_NO_SETUP` | local | reuse the existing deployment |
| `NO_COLOR` | both | plain output for recording |
