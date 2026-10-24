// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FalaVault} from "../src/FalaVault.sol";

contract LocalUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// Local-only: deploys a mock 6-dp USDC + FalaVault + demo config (anvil default accounts).
contract DeployLocal is Script {
    function run() external {
        address worker = vm.addr(vm.envUint("AGENT_PRIVATE_KEY"));
        address auditor = vm.addr(vm.envUint("AUDITOR_PRIVATE_KEY"));
        address vendorA = vm.envAddress("VENDOR_A");
        address vendorB = vm.envAddress("VENDOR_B");

        vm.startBroadcast();
        LocalUSDC usdc = new LocalUSDC();
        FalaVault vault = new FalaVault(address(usdc), msg.sender);
        usdc.mint(msg.sender, 100e6);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(10e6);
        vault.configureAgent(
            worker,
            FalaVault.Policy({
                perTxCap: 3e6,
                dailyCap: 5e6,
                coSignThreshold: 1e6,
                expiry: uint40(block.timestamp + 14 days),
                maxTxPerDay: 8,
                active: true,
                auditor: auditor
            })
        );
        vault.setPayee(worker, vendorA, true);
        vault.setPayee(worker, vendorB, true);
        vm.stopBroadcast();
        console.log("USDC ", address(usdc));
        console.log("VAULT", address(vault));
        console.log("BLOCK", block.number);
    }
}
