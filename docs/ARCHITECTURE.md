# NivGuard architecture

Design notes for the SpendFirewall contract. See the README for the project
overview.

## The problem

Giving an AI agent a wallet means giving it your money. Today the options are
bad in both directions. Hand it a hot key and it can drain the account on a
bad prompt, a bad tool call, or a prompt injection. Put a human in the loop on
every payment and the agent is not autonomous any more, it is a very expensive
form filler.

What is missing is the thing every corporate card already has: a policy that
lives outside the spender.

## The idea

NivGuard puts the spending policy onchain, in front of the money.

A business deposits USDC and registers an agent under a policy: how much per
transaction, how much per period, and which merchants it is allowed to pay.
The agent then spends on its own, with no human approval per payment. The
contract enforces the policy on every single transfer. Anything outside the
policy reverts. The owner can revoke the agent instantly, in one transaction,
and the agent is cut off in the same block.

The agent never holds the funds. It holds permission, and permission is
revocable.

Every decision is an indexed event, so the whole thing is auditable without
trusting any offchain log.

## How it works

```
     Business (owner)                      AI agent
           |                                   |
           | registerAgent                     | spend(merchant, amount)
           | setMerchantAllowed                |
           | deposit / withdraw                v
           | revokeAgent               +---------------+
           +-------------------------->| SpendFirewall |
                                       +---------------+
                                               |
                                    policy checks, in order
                                       1. registered
                                       2. not revoked
                                       3. merchant allowlisted
                                       4. amount <= maxPerTx
                                       5. period budget not exceeded
                                       6. balance sufficient
                                               |
                                  pass         |         fail
                                   +-----------+-----------+
                                   |                       |
                                   v                       v
                        USDC to the merchant      revert, specific
                        SpendAuthorized event     custom error
```

### The policy

Per agent:

| Field             | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| `budgetPerPeriod` | Total spend allowed inside one period          |
| `periodSeconds`   | Length of that period                          |
| `maxPerTx`        | Ceiling on any single payment                  |
| allowlist         | Set of merchant addresses this agent may pay   |
| `revoked`         | Kill switch, immediate and irreversible        |

Budget periods are fixed windows anchored to registration. When a window fully
elapses, the start advances by whole periods and spend resets to zero, so
windows stay aligned to the original anchor instead of drifting forward from
whenever the agent happened to transact.

### `checkSpend`, the part that drives the demo

```solidity
function checkSpend(address agent, address merchant, uint256 amount)
    external view returns (bool allowed, uint8 reasonCode);
```

A non-reverting dry run. The dashboard calls this before the agent acts, so it
can show *why* a payment would be blocked rather than just watching a
transaction fail.

| Code | Meaning                 |
| ---- | ----------------------- |
| 0    | OK                      |
| 1    | Agent not registered    |
| 2    | Agent revoked           |
| 3    | Merchant not allowlisted|
| 4    | Over `maxPerTx`         |
| 5    | Over the period budget  |
| 6    | Insufficient balance    |
| 7    | Zero amount             |

`spend` and `checkSpend` share one internal evaluation function, so the dry run
can never disagree with the real thing. There is a test that asserts exactly
that across every path.

`getPolicy` returns the full stored policy plus live derived values: the
current period start after any pending roll, spend used in that period,
remaining budget, and the agent's balance.

### Events are the audit trail

`AgentRegistered`, `PolicyUpdated`, `MerchantAllowlisted`, `Deposited`,
`Withdrawn`, `SpendAuthorized`, `AgentRevoked`. The agent address is indexed on
all of them, so a business can pull the complete history of any single agent
with one filter.

## Arc specifics

On Arc, USDC is the native gas token. It is exposed two ways over the same pool
of funds:

- native view, 18 decimals, used only for gas and `msg.value`
- ERC-20 view, 6 decimals, at `0x3600000000000000000000000000000000000000`

The two differ by a factor of 10^12. **Every amount in this contract is the
6 decimal ERC-20 view**: policy limits, balances, transfers, events. The 18
decimal native view never appears in policy math. Mixing them would be a
10^12 error, which is exactly the kind of bug a spend firewall should not have.

Arc also has sub-second deterministic finality, so the scripts wait on one
confirmation and never poll for more.

| | |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Browser RPC | `https://testnet.arcscan.app/api/eth-rpc` |
| Explorer | `https://testnet.arcscan.app` |
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` |
| Faucet | `https://faucet.circle.com` |

### The public RPC cannot be called from a browser

`https://rpc.testnet.arc.network` **sends no `access-control-allow-origin`
header on POST responses**, so a browser refuses to hand the response to page
JavaScript. Node is unaffected, because CORS is a browser policy and nothing
else enforces it. This is why the dashboard and the scripts talk to two
different endpoints, which otherwise looks like an inconsistency.

The response itself is fine. Asked for `eth_chainId` with an `Origin` header
set, the direct RPC answers correctly and omits the CORS header entirely:

```
$ curl -i -X POST https://rpc.testnet.arc.network \
    -H 'Origin: https://ueddy.github.io' \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

HTTP/1.1 200 OK
content-type: application/json
                                  <- no access-control-allow-origin
{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}
```

A JSON-RPC POST carries `Content-Type: application/json`, which is not a CORS
simple content type, so the browser sends a preflight `OPTIONS` first. That
fails even earlier: the endpoint has no `OPTIONS` handler and parses the
preflight as if it were a JSON-RPC call.

```
$ curl -i -X OPTIONS https://rpc.testnet.arc.network \
    -H 'Origin: https://ueddy.github.io' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type'

HTTP/1.1 400 Bad Request
{"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"invalid params"}}
```

So the request never reaches the POST stage. In the browser console this
surfaces as an opaque CORS failure with no status code, which reads like the
node being down rather than a missing header.

The fix is Blockscout's JSON-RPC endpoint, `https://testnet.arcscan.app/api/eth-rpc`,
which answers the same calls and sends `access-control-allow-origin: *`:

```
HTTP/1.1 200 OK
access-control-allow-origin: *
access-control-allow-credentials: true
{"jsonrpc":"2.0","result":"0x4cef52","id":1}
```

It serves `eth_call` and `eth_getLogs` over the full history with no block
range cap, which is everything the dashboard needs: `checkSpend` and
`getPolicy` are `eth_call`, and the activity feed is `eth_getLogs` from the
deployment block. It is rate limited (180 requests per window, advertised in
`x-ratelimit-limit`), which the dashboard stays well inside by polling every
15 seconds.

`scripts/syncDashboard.js` therefore writes the Blockscout URL into the
dashboard's `CONFIG`, never `network.rpcUrl`. Node-side code keeps using the
direct RPC, which is faster and has no such limit.

## Setup

Requires Node 18 or newer.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `PRIVATE_KEY` deployer key, used only for `arcTestnet`
- `USDC_ADDRESS` leave as the Arc USDC address unless testing against a mock
- `FIREWALL_OWNER` optional, defaults to the deployer

Then:

```bash
npx hardhat compile
npx hardhat test
```

Gas report:

```bash
REPORT_GAS=true npx hardhat test
```

## Deploy

Local:

```bash
npx hardhat run scripts/deploy.js
```

With no `USDC_ADDRESS` on a local network the script deploys a `MockUSDC` with
6 decimals so you get a working end to end setup immediately.

Arc testnet:

```bash
npx hardhat run scripts/deploy.js --network arcTestnet
```

Fund the deployer from `https://faucet.circle.com` first. Each deployment
writes `deployments/<network>.json` with the addresses and the deploy tx.

## Using it

```javascript
// Owner side.
await firewall.registerAgent(
  agent.address,
  parseUnits("1000", 6), // 1000 USDC per period
  86400,                 // one day
  parseUnits("250", 6)   // 250 USDC max per payment
);
await firewall.setMerchantAllowed(agent.address, apiVendor, true);
await usdc.approve(firewall.target, parseUnits("5000", 6));
await firewall.deposit(agent.address, parseUnits("5000", 6));

// Agent side, no human in the loop.
await firewall.connect(agent).spend(apiVendor, parseUnits("120", 6));

// Dashboard side, before acting.
const [allowed, reason] = await firewall.checkSpend(
  agent.address, apiVendor, parseUnits("400", 6)
);
// allowed === false, reason === 4, over maxPerTx

// Kill switch.
await firewall.revokeAgent(agent.address);
```

## Design notes

- **Custom errors, not require strings.** Cheaper, and each failure is
  distinguishable by the caller rather than a string to parse.
- **Two storage slots per policy.** Amounts are `uint128`, which holds about
  3.4e32 USDC at 6 decimals. Timestamps are `uint48`, which overflows in the
  year 8.9 million.
- **Balances are per agent, not pooled.** One agent cannot reach another's
  funds even with an identical policy. There is a test for this.
- **`totalDeposited` tracks credited funds only.** Tokens sent to the contract
  outside `deposit` are not credited to anyone and are not spendable, so a
  direct transfer cannot inflate any agent's budget.
- **Deposits credit what actually arrived**, measured by balance delta, so a
  fee on transfer token could never over-credit an agent.
- **`maxPerTx` above `budgetPerPeriod` is rejected** rather than stored, since
  such a cap could never be reached and would misrepresent the policy.
- **Revocation does not strand funds.** A revoked agent cannot spend, but the
  owner can still withdraw everything it held.
- **`updatePolicy` preserves spend already used** in the current period, so
  raising a budget mid period does not retroactively erase usage.
- `spend` is `nonReentrant` and moves tokens only after all state is written.

Measured with the optimizer at 200 runs:

| Operation       | Avg gas |
| --------------- | ------- |
| `spend`         | 73,121  |
| `registerAgent` | 73,452  |
| `updatePolicy`  | 35,119  |
| `revokeAgent`   | 30,567  |
| deployment      | 1,532,073 |

A policy-checked payment costs about 73k gas, which includes the USDC transfer
itself. The firewall adds roughly the cost of one extra storage write over a
bare transfer.

## Status

Phase 1 complete: contract, tests, deploy script.

Not built yet: the dashboard UI and the agent runner.

## Layout

```
contracts/
  SpendFirewall.sol      the firewall
  test/MockUSDC.sol      6 decimal test token, never deployed live
agent/
  runner.js              the loop an autonomous agent runs
  demo.js                the scripted five-payment narrative
  demoConfig.js          every demo number, in one place
  provision.js           create the Circle agent wallet
  signers/               Circle and local signing backends
scripts/
  deploy.js              deploy the firewall
  fundAgent.js           send a new agent wallet its gas
  setupArc.js            register, allowlist, deposit
  preflight.js           check everything before a recorded run
  agentPay.js            routine in-policy payments, revokes nothing
  syncDashboard.js       rewrite the dashboard CONFIG from the deployment
  serveWeb.js            serve web/ locally
web/
  index.html             the operator console, one self-contained file
test/
  SpendFirewall.test.js
hardhat.config.js
netlify.toml             publishes web/ to Netlify, the primary demo URL
.github/workflows/
  pages.yml              publishes web/ to GitHub Pages, the mirror
```
