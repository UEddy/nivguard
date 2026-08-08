// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGatewayWallet} from "../interfaces/IGatewayWallet.sol";

/// @notice Test only stand in for Circle's GatewayWallet. Never deployed to a
///         live network.
///
/// @dev Models only the part SpendFirewall touches: depositFor pulls tokens
///      from the caller and credits the balance to `depositor`. That
///      caller/depositor split is the whole reason the firewall design works,
///      so it is the thing the tests need to be able to observe.
///
///      The real contract also does denylist checks, pausing, ERC-1155
///      accounting and two step withdrawals. None of that changes how the
///      firewall behaves, so none of it is modelled here.
contract MockGatewayWallet is IGatewayWallet {
    using SafeERC20 for IERC20;

    mapping(address token => mapping(address depositor => uint256)) private _available;

    /// @dev Mirrors the real event signature so tests can assert on it.
    event Deposited(
        address indexed token,
        address indexed depositor,
        address indexed sender,
        uint256 value
    );

    /// @notice Set to true to make depositFor revert, standing in for a paused
    ///         or denylisting gateway.
    bool public shouldRevert;

    error MockGatewayRejected();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function depositFor(address token, address depositor, uint256 value)
        external
        override
    {
        if (shouldRevert) revert MockGatewayRejected();

        _available[token][depositor] += value;
        IERC20(token).safeTransferFrom(msg.sender, address(this), value);

        emit Deposited(token, depositor, msg.sender, value);
    }

    function availableBalance(address token, address depositor)
        external
        view
        override
        returns (uint256)
    {
        return _available[token][depositor];
    }
}
