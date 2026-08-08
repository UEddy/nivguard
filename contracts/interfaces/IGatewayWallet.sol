// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IGatewayWallet
/// @notice The slice of Circle's GatewayWallet that SpendFirewall needs.
/// @dev Circle's contract is at src/modules/wallet/Deposits.sol in
///      circlefin/evm-gateway-contracts. On Arc testnet it is deployed at
///      0x0077777d7EBA4688BDeF3E311b846F25870A19B9.
///
///      depositFor is the function that makes this whole design possible.
///      A plain deposit() credits msg.sender, which for us would be the
///      firewall, and the firewall has no private key so it could never sign
///      the offchain EIP-3009 authorizations that nanopayments are made of.
///      depositFor pulls the USDC from the firewall but credits the balance to
///      the agent, so the agent can sign against a pool it never custodied.
interface IGatewayWallet {
    /// @notice Deposit tokens on behalf of another address.
    /// @dev The resulting balance belongs to `depositor`, not to msg.sender.
    ///      msg.sender must have approved this contract for at least `value`.
    /// @param token The token to deposit. USDC in our case, 6 decimals.
    /// @param depositor The address that should own the resulting balance.
    /// @param value The amount to deposit.
    function depositFor(address token, address depositor, uint256 value) external;

    /// @notice Available (not withdrawing) balance for a depositor.
    /// @dev Read only, used by the dashboard and by tests.
    function availableBalance(address token, address depositor)
        external
        view
        returns (uint256);
}
