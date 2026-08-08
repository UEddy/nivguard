// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGatewayWallet} from "./interfaces/IGatewayWallet.sol";

/// @title SpendFirewall
/// @notice Onchain spend firewall for AI agents. A business deposits USDC and
///         registers an agent under a spending policy. The agent spends
///         autonomously within that policy and the contract blocks everything
///         outside it. The owner can revoke an agent instantly.
/// @dev Built for Arc. On Arc, USDC is the native gas token viewed at 18
///      decimals, while the USDC ERC-20 interface is 6 decimals. Every amount
///      in this contract, policy limits and transfers alike, is in the
///      6 decimal ERC-20 view. The 18 decimal native view is never used here.
contract SpendFirewall is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Reason codes
    // ---------------------------------------------------------------------
    // Returned by checkSpend so a dashboard can show why a spend would be
    // blocked without having to simulate a revert. Kept in sync with the
    // custom errors thrown by spend.

    uint8 public constant REASON_OK = 0;
    uint8 public constant REASON_NOT_REGISTERED = 1;
    uint8 public constant REASON_REVOKED = 2;
    uint8 public constant REASON_MERCHANT_NOT_ALLOWED = 3;
    uint8 public constant REASON_OVER_MAX_PER_TX = 4;
    uint8 public constant REASON_OVER_PERIOD_BUDGET = 5;
    uint8 public constant REASON_INSUFFICIENT_BALANCE = 6;
    uint8 public constant REASON_ZERO_AMOUNT = 7;
    uint8 public constant REASON_GATEWAY_NOT_CONFIGURED = 8;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AgentNotRegistered(address agent);
    error AgentAlreadyRegistered(address agent);
    error AgentIsRevoked(address agent);
    error MerchantNotAllowed(address agent, address merchant);
    error ExceedsMaxPerTx(uint256 amount, uint256 maxPerTx);
    error ExceedsPeriodBudget(uint256 attempted, uint256 remaining);
    error InsufficientAgentBalance(uint256 amount, uint256 balance);
    error ZeroAmount();
    error ZeroAddress();
    error InvalidPolicy();
    error GatewayNotConfigured();
    error NotAgentOrOwner(address caller, address agent);

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev Packed into two storage slots.
    ///      slot 0: budgetPerPeriod + maxPerTx
    ///      slot 1: periodSpent + periodSeconds + periodStart + flags
    ///      uint128 holds ~3.4e32 USDC at 6 decimals, far beyond any real cap.
    ///      uint48 timestamps overflow in the year 8.9 million.
    struct Policy {
        uint128 budgetPerPeriod;
        uint128 maxPerTx;
        uint128 periodSpent;
        uint48 periodSeconds;
        uint48 periodStart;
        bool registered;
        bool revoked;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice USDC ERC-20 interface, 6 decimals.
    IERC20 public immutable usdc;

    /// @notice Circle's GatewayWallet, the deposit contract behind nanopayments.
    /// @dev Settable rather than immutable on purpose. The address is a Circle
    ///      deployment that differs per chain and does not exist at all on the
    ///      local hardhat node, so a constructor argument would force every
    ///      local deploy to invent one. Zero means gateway funding is simply
    ///      switched off, and fundGateway reverts rather than burning budget.
    address public gatewayWallet;

    mapping(address agent => Policy) private _policies;
    mapping(address agent => uint256 balance) private _balances;
    mapping(address agent => mapping(address merchant => bool)) private _allowlist;

    /// @notice Sum of all agent balances. Tokens sent to this contract outside
    ///         of deposit are not credited to anyone and are not spendable.
    uint256 public totalDeposited;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    // These events are the audit trail. The agent address is indexed on all
    // of them so a business can filter the full history of any single agent.

    event AgentRegistered(
        address indexed agent,
        uint256 budgetPerPeriod,
        uint256 periodSeconds,
        uint256 maxPerTx
    );

    event PolicyUpdated(
        address indexed agent,
        uint256 budgetPerPeriod,
        uint256 periodSeconds,
        uint256 maxPerTx
    );

    event MerchantAllowlisted(
        address indexed agent,
        address indexed merchant,
        bool allowed
    );

    event Deposited(
        address indexed agent,
        address indexed from,
        uint256 amount,
        uint256 newBalance
    );

    event Withdrawn(
        address indexed agent,
        address indexed to,
        uint256 amount,
        uint256 newBalance
    );

    event SpendAuthorized(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 periodSpent,
        uint256 remainingInPeriod
    );

    event AgentRevoked(address indexed agent);

    /// @notice Emitted when the owner points the firewall at a GatewayWallet.
    event GatewayWalletUpdated(address indexed previous, address indexed current);

    /// @notice Emitted when budget leaves the firewall into an agent's Gateway
    ///         balance, to be spent later as offchain nanopayments.
    /// @dev Deliberately distinct from SpendAuthorized. A SpendAuthorized event
    ///      means the money reached a named merchant and the story is over. A
    ///      GatewayFunded event means the money entered a pool that this
    ///      contract can no longer see, and the individual nanopayments drawn
    ///      from it will never appear onchain one by one. An auditor reading
    ///      the log needs to be able to tell those two things apart, so they
    ///      are two events rather than one with a flag.
    event GatewayFunded(
        address indexed agent,
        address indexed gateway,
        uint256 amount,
        uint256 periodSpent,
        uint256 remainingInPeriod
    );

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param usdc_ USDC ERC-20 interface address, 6 decimals.
    /// @param initialOwner Business account that controls policies and funds.
    constructor(address usdc_, address initialOwner) Ownable(initialOwner) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    // ---------------------------------------------------------------------
    // Owner: policy management
    // ---------------------------------------------------------------------

    /// @notice Register a new agent under a spending policy.
    /// @param agent Address the agent signs with.
    /// @param budgetPerPeriod Max total spend per rolling period, 6 decimals.
    /// @param periodSeconds Length of the budget period in seconds.
    /// @param maxPerTx Max size of any single spend, 6 decimals.
    function registerAgent(
        address agent,
        uint256 budgetPerPeriod,
        uint256 periodSeconds,
        uint256 maxPerTx
    ) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (_policies[agent].registered) revert AgentAlreadyRegistered(agent);

        _validatePolicy(budgetPerPeriod, periodSeconds, maxPerTx);

        _policies[agent] = Policy({
            budgetPerPeriod: uint128(budgetPerPeriod),
            maxPerTx: uint128(maxPerTx),
            periodSpent: 0,
            periodSeconds: uint48(periodSeconds),
            periodStart: uint48(block.timestamp),
            registered: true,
            revoked: false
        });

        emit AgentRegistered(agent, budgetPerPeriod, periodSeconds, maxPerTx);
    }

    /// @notice Change an existing agent's policy.
    /// @dev Spend already recorded in the current period is preserved, so
    ///      raising a budget mid period does not retroactively erase usage and
    ///      lowering it below current usage simply leaves zero remaining.
    ///      Changing periodSeconds re-anchors the window to now.
    function updatePolicy(
        address agent,
        uint256 budgetPerPeriod,
        uint256 periodSeconds,
        uint256 maxPerTx
    ) external onlyOwner {
        Policy storage p = _policies[agent];
        if (!p.registered) revert AgentNotRegistered(agent);
        if (p.revoked) revert AgentIsRevoked(agent);

        _validatePolicy(budgetPerPeriod, periodSeconds, maxPerTx);

        // Settle the window first so a pending roll is not lost by the update.
        (uint48 windowStart, uint128 spentInWindow) = _window(p);

        p.budgetPerPeriod = uint128(budgetPerPeriod);
        p.maxPerTx = uint128(maxPerTx);
        p.periodSpent = spentInWindow;

        if (p.periodSeconds != uint48(periodSeconds)) {
            p.periodSeconds = uint48(periodSeconds);
            p.periodStart = uint48(block.timestamp);
        } else {
            p.periodStart = windowStart;
        }

        emit PolicyUpdated(agent, budgetPerPeriod, periodSeconds, maxPerTx);
    }

    /// @notice Add or remove a merchant from an agent's allowlist.
    function setMerchantAllowed(
        address agent,
        address merchant,
        bool allowed
    ) external onlyOwner {
        if (!_policies[agent].registered) revert AgentNotRegistered(agent);
        if (merchant == address(0)) revert ZeroAddress();

        _allowlist[agent][merchant] = allowed;
        emit MerchantAllowlisted(agent, merchant, allowed);
    }

    /// @notice Point the firewall at Circle's GatewayWallet, or set the zero
    ///         address to switch gateway funding off entirely.
    /// @dev Changing this does not move any funds. Balances already credited to
    ///      an agent inside the old gateway stay where they are.
    function setGatewayWallet(address gatewayWallet_) external onlyOwner {
        address previous = gatewayWallet;
        gatewayWallet = gatewayWallet_;
        emit GatewayWalletUpdated(previous, gatewayWallet_);
    }

    /// @notice Revoke an agent. Takes effect immediately. The agent cannot
    ///         spend again. Remaining funds stay withdrawable by the owner.
    function revokeAgent(address agent) external onlyOwner {
        Policy storage p = _policies[agent];
        if (!p.registered) revert AgentNotRegistered(agent);
        if (p.revoked) revert AgentIsRevoked(agent);

        p.revoked = true;
        emit AgentRevoked(agent);
    }

    // ---------------------------------------------------------------------
    // Owner: funding
    // ---------------------------------------------------------------------

    /// @notice Fund an agent. Pulls USDC from the caller.
    /// @dev Caller must have approved this contract for at least `amount`.
    function deposit(address agent, uint256 amount) external onlyOwner nonReentrant {
        Policy storage p = _policies[agent];
        if (!p.registered) revert AgentNotRegistered(agent);
        if (p.revoked) revert AgentIsRevoked(agent);
        if (amount == 0) revert ZeroAmount();

        // Credit against the amount actually received so a fee on transfer
        // token can never over credit the agent.
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;

        uint256 newBalance = _balances[agent] + received;
        _balances[agent] = newBalance;
        totalDeposited += received;

        emit Deposited(agent, msg.sender, received, newBalance);
    }

    /// @notice Pull funds back out of an agent. Works even after revocation.
    function withdraw(address agent, uint256 amount) external onlyOwner nonReentrant {
        if (!_policies[agent].registered) revert AgentNotRegistered(agent);
        if (amount == 0) revert ZeroAmount();

        uint256 balance = _balances[agent];
        if (amount > balance) revert InsufficientAgentBalance(amount, balance);

        uint256 newBalance = balance - amount;
        _balances[agent] = newBalance;
        totalDeposited -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(agent, msg.sender, amount, newBalance);
    }

    // ---------------------------------------------------------------------
    // Agent
    // ---------------------------------------------------------------------

    /// @notice Spend from the caller's agent budget to a merchant.
    /// @dev Checks run in this order: registered, not revoked, merchant
    ///      allowlisted, within maxPerTx, within the period budget, and
    ///      sufficient balance. Each failure reverts with its own error.
    function spend(address merchant, uint256 amount) external nonReentrant {
        address agent = msg.sender;

        (uint8 reason, uint48 windowStart, uint128 spentInWindow) =
            _evaluate(agent, merchant, amount);

        if (reason != REASON_OK) _revertFor(agent, merchant, amount, reason, spentInWindow);

        Policy storage p = _policies[agent];

        // amount is bounded by maxPerTx, and the sum is bounded by
        // budgetPerPeriod, so both fit uint128 by construction.
        uint128 newSpent = spentInWindow + uint128(amount);
        p.periodSpent = newSpent;
        p.periodStart = windowStart;

        uint256 newBalance = _balances[agent] - amount;
        _balances[agent] = newBalance;
        totalDeposited -= amount;

        usdc.safeTransfer(merchant, amount);

        emit SpendAuthorized(
            agent,
            merchant,
            amount,
            newSpent,
            p.budgetPerPeriod - newSpent
        );
    }

    /// @notice Move budget out of the firewall and into the agent's Circle
    ///         Gateway balance, so the agent can pay for things in offchain
    ///         nanopayments too small to be worth a transaction each.
    ///
    /// @dev Every policy check that spend() runs, this runs, against the same
    ///      period budget and the same per transaction cap. The GatewayWallet
    ///      address is treated as the destination, so the owner has to
    ///      allowlist it exactly like any other merchant before an agent can
    ///      top up. Gateway funding is therefore opt in per agent, and
    ///      revoking an agent kills its top ups along with its spending.
    ///
    ///      Sharing one budget with spend() is the point. An agent cannot get
    ///      around a 3 USDC daily cap by taking 3 USDC of merchant payments and
    ///      then another 3 USDC into the nanopayment pool. Total outflow is
    ///      what the policy caps, whichever door it leaves by.
    ///
    ///      What this does NOT do, and cannot: gate the individual
    ///      nanopayments. Those are offchain EIP-3009 authorizations that
    ///      Circle batches and settles, so no onchain call exists for this
    ///      contract to sit in front of. Once funds are in the Gateway balance
    ///      the agent is the depositor and can spend or withdraw them without
    ///      asking. The firewall controls the tap, not each drop.
    ///
    /// @param agent The agent whose policy is charged and whose Gateway
    ///        balance is credited.
    /// @param amount Amount to move, 6 decimals.
    function fundGateway(address agent, uint256 amount) external nonReentrant {
        // The agent parameter is not an authorisation. Without this check
        // anyone could push another agent's funds into the gateway and burn
        // that agent's budget for it. The owner is allowed because it can
        // already deposit and withdraw on the agent's behalf.
        if (msg.sender != agent && msg.sender != owner()) {
            revert NotAgentOrOwner(msg.sender, agent);
        }

        address gateway = gatewayWallet;
        if (gateway == address(0)) revert GatewayNotConfigured();

        (uint8 reason, uint48 windowStart, uint128 spentInWindow) =
            _evaluate(agent, gateway, amount);

        if (reason != REASON_OK) _revertFor(agent, gateway, amount, reason, spentInWindow);

        Policy storage p = _policies[agent];

        uint128 newSpent = spentInWindow + uint128(amount);
        p.periodSpent = newSpent;
        p.periodStart = windowStart;

        uint256 newBalance = _balances[agent] - amount;
        _balances[agent] = newBalance;
        totalDeposited -= amount;

        // State is fully settled before the external calls below, so a
        // misbehaving gateway cannot re-enter into a stale budget. The
        // nonReentrant guard is belt and braces on top of that.
        //
        // depositFor pulls from this contract but credits the agent, which is
        // what lets the agent sign nanopayment authorizations against a pool
        // it was never trusted to custody directly.
        usdc.forceApprove(gateway, amount);
        IGatewayWallet(gateway).depositFor(address(usdc), agent, amount);

        // Leave no standing allowance behind. depositFor consumes exactly
        // `amount`, so this normally writes zero over zero, but an allowance
        // from the firewall to anything is worth clearing rather than trusting.
        usdc.forceApprove(gateway, 0);

        emit GatewayFunded(
            agent,
            gateway,
            amount,
            newSpent,
            p.budgetPerPeriod - newSpent
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Non reverting dry run of a spend. This drives the dashboard so
    ///         it can show why something would be blocked before it is tried.
    /// @return allowed True if spend would succeed right now.
    /// @return reasonCode REASON_OK on success, otherwise the first failing check.
    function checkSpend(
        address agent,
        address merchant,
        uint256 amount
    ) external view returns (bool allowed, uint8 reasonCode) {
        (reasonCode, , ) = _evaluate(agent, merchant, amount);
        allowed = reasonCode == REASON_OK;
    }

    /// @notice Non reverting dry run of a gateway top up, the counterpart to
    ///         checkSpend. Same shape so the runner can treat both the same.
    /// @return allowed True if fundGateway would succeed right now.
    /// @return reasonCode REASON_OK, or the first failing check.
    ///         REASON_GATEWAY_NOT_CONFIGURED if no gateway has been set.
    function checkFundGateway(address agent, uint256 amount)
        external
        view
        returns (bool allowed, uint8 reasonCode)
    {
        address gateway = gatewayWallet;
        if (gateway == address(0)) {
            return (false, REASON_GATEWAY_NOT_CONFIGURED);
        }
        (reasonCode, , ) = _evaluate(agent, gateway, amount);
        allowed = reasonCode == REASON_OK;
    }

    /// @notice Full policy state for an agent plus derived live values.
    /// @return registered Whether the agent was ever registered.
    /// @return revoked Whether the agent is revoked.
    /// @return budgetPerPeriod Spend cap per period, 6 decimals.
    /// @return periodSeconds Period length in seconds.
    /// @return maxPerTx Per transaction cap, 6 decimals.
    /// @return periodStart Start of the current period after any pending roll.
    /// @return periodSpent Spend inside the current period after any roll.
    /// @return remainingInPeriod Budget still available in the current period.
    /// @return balance Agent's deposited USDC held by this contract.
    function getPolicy(address agent)
        external
        view
        returns (
            bool registered,
            bool revoked,
            uint256 budgetPerPeriod,
            uint256 periodSeconds,
            uint256 maxPerTx,
            uint256 periodStart,
            uint256 periodSpent,
            uint256 remainingInPeriod,
            uint256 balance
        )
    {
        Policy storage p = _policies[agent];

        registered = p.registered;
        revoked = p.revoked;
        budgetPerPeriod = p.budgetPerPeriod;
        periodSeconds = p.periodSeconds;
        maxPerTx = p.maxPerTx;
        balance = _balances[agent];

        if (!registered) {
            return (
                registered,
                revoked,
                budgetPerPeriod,
                periodSeconds,
                maxPerTx,
                0,
                0,
                0,
                balance
            );
        }

        (uint48 windowStart, uint128 spentInWindow) = _window(p);
        periodStart = windowStart;
        periodSpent = spentInWindow;
        remainingInPeriod = revoked ? 0 : _remaining(p.budgetPerPeriod, spentInWindow);
    }

    /// @notice Deposited USDC held for an agent, 6 decimals.
    function balanceOfAgent(address agent) external view returns (uint256) {
        return _balances[agent];
    }

    /// @notice Whether a merchant is on an agent's allowlist.
    function isMerchantAllowed(address agent, address merchant)
        external
        view
        returns (bool)
    {
        return _allowlist[agent][merchant];
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _validatePolicy(
        uint256 budgetPerPeriod,
        uint256 periodSeconds,
        uint256 maxPerTx
    ) private pure {
        if (budgetPerPeriod == 0 || maxPerTx == 0 || periodSeconds == 0) {
            revert InvalidPolicy();
        }
        // A per transaction cap above the period budget can never be reached,
        // so reject it rather than store a misleading policy.
        if (maxPerTx > budgetPerPeriod) revert InvalidPolicy();
        if (budgetPerPeriod > type(uint128).max) revert InvalidPolicy();
        if (periodSeconds > type(uint48).max) revert InvalidPolicy();
    }

    /// @dev Saturating subtraction. updatePolicy can lower a budget below the
    ///      spend already recorded in the current period, which would make a
    ///      plain subtraction underflow. Remaining budget floors at zero.
    function _remaining(uint128 budget, uint128 spent)
        private
        pure
        returns (uint256)
    {
        return budget > spent ? budget - spent : 0;
    }

    /// @dev Resolve the live budget window. If the stored period has fully
    ///      elapsed, advance the start by whole periods and reset spend so
    ///      windows stay aligned to the original anchor instead of drifting.
    function _window(Policy storage p)
        private
        view
        returns (uint48 windowStart, uint128 spentInWindow)
    {
        uint48 start = p.periodStart;
        uint48 length = p.periodSeconds;

        unchecked {
            uint256 elapsed = block.timestamp - start;
            if (elapsed < length) {
                return (start, p.periodSpent);
            }
            uint256 advanced = uint256(start) + (elapsed / length) * length;
            return (uint48(advanced), 0);
        }
    }

    /// @dev Single source of truth for the policy decision, shared by spend
    ///      and checkSpend so the dry run can never disagree with the real one.
    function _evaluate(address agent, address merchant, uint256 amount)
        private
        view
        returns (uint8 reason, uint48 windowStart, uint128 spentInWindow)
    {
        Policy storage p = _policies[agent];

        if (!p.registered) return (REASON_NOT_REGISTERED, 0, 0);
        if (p.revoked) return (REASON_REVOKED, 0, 0);

        (windowStart, spentInWindow) = _window(p);

        if (amount == 0) return (REASON_ZERO_AMOUNT, windowStart, spentInWindow);
        if (!_allowlist[agent][merchant]) {
            return (REASON_MERCHANT_NOT_ALLOWED, windowStart, spentInWindow);
        }
        if (amount > p.maxPerTx) {
            return (REASON_OVER_MAX_PER_TX, windowStart, spentInWindow);
        }
        if (uint256(spentInWindow) + amount > p.budgetPerPeriod) {
            return (REASON_OVER_PERIOD_BUDGET, windowStart, spentInWindow);
        }
        if (amount > _balances[agent]) {
            return (REASON_INSUFFICIENT_BALANCE, windowStart, spentInWindow);
        }

        return (REASON_OK, windowStart, spentInWindow);
    }

    /// @dev Map a reason code to its custom error. Keeps spend and checkSpend
    ///      reporting the same decision through two different channels.
    function _revertFor(
        address agent,
        address merchant,
        uint256 amount,
        uint8 reason,
        uint128 spentInWindow
    ) private view {
        if (reason == REASON_NOT_REGISTERED) revert AgentNotRegistered(agent);
        if (reason == REASON_REVOKED) revert AgentIsRevoked(agent);
        if (reason == REASON_ZERO_AMOUNT) revert ZeroAmount();
        if (reason == REASON_MERCHANT_NOT_ALLOWED) {
            revert MerchantNotAllowed(agent, merchant);
        }
        if (reason == REASON_OVER_MAX_PER_TX) {
            revert ExceedsMaxPerTx(amount, _policies[agent].maxPerTx);
        }
        if (reason == REASON_OVER_PERIOD_BUDGET) {
            revert ExceedsPeriodBudget(
                amount,
                _remaining(_policies[agent].budgetPerPeriod, spentInWindow)
            );
        }
        revert InsufficientAgentBalance(amount, _balances[agent]);
    }
}
