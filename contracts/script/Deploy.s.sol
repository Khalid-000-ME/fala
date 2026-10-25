// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FalaVault} from "../src/FalaVault.sol";

// APPROVER_EMAIL=you@gmail.com DKIM_DOMAIN=gmail.com DKIM_SELECTOR=<selector> DKIM_N=0x.. DKIM_E=0x010001 \
// forge script script/Deploy.s.sol --rpc-url $RPC --private-key $KEY --broadcast --gas-price 25000000000 --priority-gas-price 1000000000
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (FalaVault vault) {
        address usdc = vm.envOr("USDC", ARC_USDC);
        string memory email = vm.envString("APPROVER_EMAIL");
        string memory domain = vm.envOr("DKIM_DOMAIN", string("gmail.com"));
        string memory selector = vm.envString("DKIM_SELECTOR");
        bytes memory n = vm.envBytes("DKIM_N");
        bytes memory e = vm.envOr("DKIM_E", bytes(hex"010001"));

        vm.startBroadcast();
        vault = new FalaVault(usdc, msg.sender, email, domain, selector, n, e);
        vm.stopBroadcast();
        console.log("FalaVault", address(vault));
    }
}
