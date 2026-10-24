// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FalaVault} from "../src/FalaVault.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --account fala-deployer --broadcast \
///   --gas-price 25gwei --priority-gas-price 1gwei
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (FalaVault vault) {
        address usdc = vm.envOr("USDC", ARC_USDC);
        vm.startBroadcast();
        vault = new FalaVault(usdc, msg.sender);
        vm.stopBroadcast();
        console.log("FalaVault", address(vault));
        console.log("block", block.number);
    }
}
