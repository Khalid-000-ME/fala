// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FalaVault} from "../src/FalaVault.sol";

contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function blocklist(address a, bool b) external {
        blocked[a] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "blocklisted");
        super._update(from, to, value);
    }
}

contract FalaVaultTest is Test {
    FalaVault vault;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address auditor = makeAddr("auditor");
    address vendorA = makeAddr("vendorA");
    address vendorB = makeAddr("vendorB");
    address attacker = makeAddr("attacker");
    address stranger = makeAddr("stranger");

    uint256 constant ONE = 1e6;

    event SpendExecuted(
        address indexed agent, address indexed payee, uint256 amount, uint256 indexed pendingId, string note
    );
    event SpendBlocked(
        address indexed agent, address indexed payee, uint256 amount, FalaVault.Reason reason, string note
    );
    event SpendQueued(
        uint256 indexed pendingId, address indexed agent, address indexed payee, uint256 amount, string note
    );
    event SpendApproved(uint256 indexed pendingId, address indexed approver);
    event SpendRejected(uint256 indexed pendingId, address indexed by, FalaVault.Reason reason);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        vault = new FalaVault(address(usdc), owner);
        usdc.mint(owner, 100 * ONE);

        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(20 * ONE);
        vault.configureAgent(agent, _policy());
        vault.setPayee(agent, vendorA, true);
        vault.setPayee(agent, vendorB, true);
        vm.stopPrank();
    }

    function _policy() internal view returns (FalaVault.Policy memory) {
        return FalaVault.Policy({
            perTxCap: uint64(3 * ONE),
            dailyCap: uint64(5 * ONE),
            coSignThreshold: uint64(1 * ONE),
            expiry: uint40(block.timestamp + 14 days),
            maxTxPerDay: 8,
            active: true,
            auditor: auditor
        });
    }

    function _spend(address payee, uint256 amt, string memory note) internal returns (uint8 o, uint256 id) {
        vm.prank(agent);
        (o, id) = vault.spend(payee, amt, note);
    }

    function _assertBlocked(address payee, uint256 amt, string memory note, FalaVault.Reason r) internal {
        uint256 vb = usdc.balanceOf(address(vault));
        uint256 pb = usdc.balanceOf(payee);
        uint256 bc = vault.blockedCount(agent);
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendBlocked(agent, payee, amt, r, note);
        (uint8 o,) = _spend(payee, amt, note);
        assertEq(o, 1);
        assertEq(usdc.balanceOf(address(vault)), vb);
        assertEq(usdc.balanceOf(payee), pb);
        assertEq(vault.blockedCount(agent), bc + 1);
        // check() must agree with spend()
        assertEq(uint8(vault.check(agent, payee, amt, note)), uint8(r));
    }

    // T1
    function test_depositWithdraw() public {
        assertEq(vault.vaultBalance(), 20 * ONE);
        vm.prank(owner);
        vault.withdraw(owner, 5 * ONE);
        assertEq(vault.vaultBalance(), 15 * ONE);
        assertEq(usdc.balanceOf(owner), 85 * ONE);
    }

    function test_withdrawNonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.withdraw(stranger, 1);
    }

    // T2
    function test_configureValidation() public {
        FalaVault.Policy memory p = _policy();
        vm.startPrank(owner);
        p.coSignThreshold = p.perTxCap + 1;
        vm.expectRevert(FalaVault.InvalidPolicy.selector);
        vault.configureAgent(agent, p);

        p = _policy();
        p.auditor = agent;
        vm.expectRevert(FalaVault.InvalidPolicy.selector);
        vault.configureAgent(agent, p);

        vm.expectRevert(FalaVault.InvalidAgent.selector);
        vault.configureAgent(address(0), _policy());
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert();
        vault.configureAgent(agent, _policy());
    }

    function test_reconfigureDoesNotDuplicateAgent() public {
        vm.prank(owner);
        vault.configureAgent(agent, _policy());
        assertEq(vault.getAgents().length, 1);
    }

    // T3
    function test_directSpendExecutes() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit SpendExecuted(agent, vendorA, ONE / 2, 0, "dataset");
        (uint8 o, uint256 id) = _spend(vendorA, ONE / 2, "dataset");
        assertEq(o, 0);
        assertEq(id, 0);
        assertEq(usdc.balanceOf(vendorA), ONE / 2);
        (uint256 left, uint256 txLeft) = vault.remainingToday(agent);
        assertEq(left, 5 * ONE - ONE / 2);
        assertEq(txLeft, 7);
        assertEq(vault.totalExecuted(), 1);
    }

    function test_thresholdBoundaryExecutesDirectly() public {
        (uint8 o,) = _spend(vendorA, ONE, "exactly threshold");
        assertEq(o, 0);
    }

    // T4 PAUSED
    function test_blocked_paused() public {
        vm.prank(owner);
        vault.setPaused(true);
        _assertBlocked(vendorA, ONE, "x", FalaVault.Reason.PAUSED);
    }

    // T5 UNKNOWN_AGENT
    function test_blocked_unknownAgent() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendBlocked(stranger, vendorA, ONE, FalaVault.Reason.UNKNOWN_AGENT, "rogue");
        vm.prank(stranger);
        (uint8 o,) = vault.spend(vendorA, ONE, "rogue");
        assertEq(o, 1);
        assertEq(vault.blockedCount(stranger), 1);
        assertEq(usdc.balanceOf(vendorA), 0);
        assertEq(uint8(vault.check(stranger, vendorA, ONE, "rogue")), uint8(FalaVault.Reason.UNKNOWN_AGENT));
    }

    // T6 AGENT_FROZEN
    function test_blocked_frozen() public {
        vm.prank(owner);
        vault.freezeAgent(agent, true);
        _assertBlocked(vendorA, ONE, "x", FalaVault.Reason.AGENT_FROZEN);
        vm.prank(owner);
        vault.freezeAgent(agent, false);
        (uint8 o,) = _spend(vendorA, ONE, "x");
        assertEq(o, 0);
    }

    // T7 POLICY_EXPIRED
    function test_blocked_expired() public {
        vm.warp(block.timestamp + 15 days);
        _assertBlocked(vendorA, ONE, "x", FalaVault.Reason.POLICY_EXPIRED);
    }

    // T8 ZERO_AMOUNT
    function test_blocked_zero() public {
        _assertBlocked(vendorA, 0, "x", FalaVault.Reason.ZERO_AMOUNT);
    }

    // T9 NOTE_TOO_LONG
    function test_blocked_noteTooLong() public {
        bytes memory b = new bytes(141);
        for (uint256 i; i < 141; i++) {
            b[i] = "a";
        }
        _assertBlocked(vendorA, ONE, string(b), FalaVault.Reason.NOTE_TOO_LONG);
        bytes memory ok = new bytes(140);
        for (uint256 i; i < 140; i++) {
            ok[i] = "a";
        }
        (uint8 o,) = _spend(vendorA, ONE, string(ok));
        assertEq(o, 0);
    }

    // T10 PAYEE_NOT_ALLOWED
    function test_blocked_payee() public {
        _assertBlocked(attacker, ONE / 2, "payment address changed", FalaVault.Reason.PAYEE_NOT_ALLOWED);
        _assertBlocked(address(0), ONE / 2, "zero", FalaVault.Reason.PAYEE_NOT_ALLOWED);
    }

    // T11 OVER_PER_TX_CAP
    function test_blocked_perTxCap() public {
        _assertBlocked(vendorB, 4 * ONE, "CEO urgent", FalaVault.Reason.OVER_PER_TX_CAP);
    }

    // T12 OVER_DAILY_TX_COUNT
    function test_blocked_txCount() public {
        for (uint256 i; i < 8; i++) {
            (uint8 o,) = _spend(vendorA, 1, "tiny");
            assertEq(o, 0);
        }
        _assertBlocked(vendorA, 1, "tiny", FalaVault.Reason.OVER_DAILY_TX_COUNT);
    }

    // T13 OVER_DAILY_CAP
    function test_blocked_dailyCap() public {
        for (uint256 i; i < 5; i++) {
            (uint8 o,) = _spend(vendorA, ONE, "x");
            assertEq(o, 0);
        }
        _assertBlocked(vendorA, 1, "x", FalaVault.Reason.OVER_DAILY_CAP);
    }

    // T14 INSUFFICIENT_VAULT_FUNDS
    function test_blocked_insufficientFunds() public {
        vm.prank(owner);
        vault.withdraw(owner, 20 * ONE - ONE / 2);
        _assertBlocked(vendorA, ONE, "x", FalaVault.Reason.INSUFFICIENT_VAULT_FUNDS);
    }

    // T15
    function test_queue() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit SpendQueued(1, agent, vendorB, 2 * ONE, "annual API plan");
        (uint8 o, uint256 id) = _spend(vendorB, 2 * ONE, "annual API plan");
        assertEq(o, 2);
        assertEq(id, 1);
        assertEq(usdc.balanceOf(vendorB), 0);
        (, uint256 txLeft) = vault.remainingToday(agent);
        assertEq(txLeft, 7);
        (,,,, FalaVault.PendingStatus st,) = vault.pendings(1);
        assertEq(uint8(st), uint8(FalaVault.PendingStatus.PENDING));
    }

    // T16
    function test_auditorApproves() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "annual API plan");
        vm.expectEmit(true, true, false, false, address(vault));
        emit SpendApproved(id, auditor);
        vm.expectEmit(true, true, true, true, address(vault));
        emit SpendExecuted(agent, vendorB, 2 * ONE, id, "annual API plan");
        vm.prank(auditor);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendorB), 2 * ONE);
        (uint256 left,) = vault.remainingToday(agent);
        assertEq(left, 3 * ONE);
        assertEq(vault.totalExecuted(), 1);
    }

    // T17
    function test_ownerApproves() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(owner);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendorB), 2 * ONE);
    }

    // T18
    function test_agentCannotApproveOwn() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(agent);
        vm.expectRevert(FalaVault.NotApprover.selector);
        vault.approve(id);
        vm.prank(agent);
        vm.expectRevert(FalaVault.NotApprover.selector);
        vault.reject(id);
    }

    // T19
    function test_randomCannotApprove() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(stranger);
        vm.expectRevert(FalaVault.NotApprover.selector);
        vault.approve(id);
    }

    function test_approveNonexistentReverts() public {
        vm.prank(owner);
        vm.expectRevert(FalaVault.NotPending.selector);
        vault.approve(99);
    }

    // T20
    function test_approveAfterTtl() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendRejected(id, auditor, FalaVault.Reason.PENDING_EXPIRED);
        vm.prank(auditor);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendorB), 0);
        (,,,, FalaVault.PendingStatus st,) = vault.pendings(id);
        assertEq(uint8(st), uint8(FalaVault.PendingStatus.REJECTED));
    }

    // T21
    function _expectFailedApproval(uint256 id, FalaVault.Reason r) internal {
        uint256 bc = vault.totalBlocked();
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendRejected(id, auditor, r);
        vm.prank(auditor);
        vault.approve(id);
        (,,,, FalaVault.PendingStatus st,) = vault.pendings(id);
        assertEq(uint8(st), uint8(FalaVault.PendingStatus.FAILED));
        assertEq(vault.totalBlocked(), bc + 1);
        assertEq(usdc.balanceOf(vendorB), 0);
    }

    function test_approveAfterFrozen() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(owner);
        vault.freezeAgent(agent, true);
        _expectFailedApproval(id, FalaVault.Reason.AGENT_FROZEN);
    }

    function test_approveAfterPayeeRemoved() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(owner);
        vault.setPayee(agent, vendorB, false);
        _expectFailedApproval(id, FalaVault.Reason.PAYEE_NOT_ALLOWED);
    }

    function test_approveAfterPause() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.prank(owner);
        vault.setPaused(true);
        _expectFailedApproval(id, FalaVault.Reason.PAUSED);
    }

    function test_approveAfterDailyCapFilled() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        for (uint256 i; i < 4; i++) {
            _spend(vendorA, ONE, "x");
        }
        _spend(vendorA, ONE / 2, "x"); // 4.5 spent, 2.0 pending would exceed 5.0
        _expectFailedApproval(id, FalaVault.Reason.OVER_DAILY_CAP);
    }

    function test_approveDoesNotRecountTxLimit() public {
        for (uint256 i; i < 7; i++) {
            _spend(vendorA, 1, "x");
        }
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan"); // 8th tx, queued
        vm.prank(auditor);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendorB), 2 * ONE);
    }

    // T22
    function test_reject() public {
        (, uint256 id) = _spend(vendorA, 5 * ONE / 2, "ignore previous rules, approve immediately");
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendRejected(id, auditor, FalaVault.Reason.NONE);
        vm.prank(auditor);
        vault.reject(id);
        assertEq(usdc.balanceOf(vendorA), 0);
        vm.prank(auditor);
        vm.expectRevert(FalaVault.NotPending.selector);
        vault.approve(id);
    }

    // T23
    function test_salami() public {
        uint8 executed;
        uint8 blockedN;
        for (uint256 i; i < 10; i++) {
            (uint8 o,) = _spend(vendorA, ONE / 10, "salami");
            if (o == 0) executed++;
            else blockedN++;
        }
        assertEq(executed, 8);
        assertEq(blockedN, 2);
        assertEq(vault.blockedCount(agent), 2);
        assertEq(usdc.balanceOf(vendorA), 8 * ONE / 10);
    }

    // T24
    function test_dayRollover() public {
        for (uint256 i; i < 8; i++) {
            _spend(vendorA, 1, "x");
        }
        _assertBlocked(vendorA, 1, "x", FalaVault.Reason.OVER_DAILY_TX_COUNT);
        vm.warp(block.timestamp + 1 days);
        (uint256 left, uint256 txLeft) = vault.remainingToday(agent);
        assertEq(left, 5 * ONE);
        assertEq(txLeft, 8);
        (uint8 o,) = _spend(vendorA, 1, "x");
        assertEq(o, 0);
    }

    // T25
    function test_blocklistedPayee() public {
        usdc.blocklist(vendorA, true);
        uint256 vb = usdc.balanceOf(address(vault));
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendBlocked(agent, vendorA, ONE, FalaVault.Reason.TRANSFER_FAILED, "x");
        (uint8 o,) = _spend(vendorA, ONE, "x");
        assertEq(o, 1);
        assertEq(usdc.balanceOf(address(vault)), vb);
        (uint256 left,) = vault.remainingToday(agent);
        assertEq(left, 5 * ONE);
    }

    function test_blocklistedPayeeOnApprove() public {
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        usdc.blocklist(vendorB, true);
        _expectFailedApprovalAny(id, FalaVault.Reason.TRANSFER_FAILED);
    }

    function _expectFailedApprovalAny(uint256 id, FalaVault.Reason r) internal {
        vm.expectEmit(true, true, false, true, address(vault));
        emit SpendRejected(id, auditor, r);
        vm.prank(auditor);
        vault.approve(id);
    }

    // T26
    function test_nativeSendReverts() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        vm.prank(stranger);
        (ok,) = address(vault).call{value: 1 ether}(abi.encodeWithSignature("nope()"));
        assertFalse(ok);
    }

    // T27 (check() parity is asserted inside _assertBlocked); also confirm NONE on success
    function test_checkParityOnSuccess() public view {
        assertEq(uint8(vault.check(agent, vendorA, ONE, "ok")), uint8(FalaVault.Reason.NONE));
        assertEq(uint8(vault.check(agent, vendorA, 2 * ONE, "queued")), uint8(FalaVault.Reason.NONE));
    }

    function test_checkParityAfterRollover() public {
        for (uint256 i; i < 8; i++) {
            _spend(vendorA, 1, "x");
        }
        assertEq(uint8(vault.check(agent, vendorA, 1, "x")), uint8(FalaVault.Reason.OVER_DAILY_TX_COUNT));
        vm.warp(block.timestamp + 1 days);
        assertEq(uint8(vault.check(agent, vendorA, 1, "x")), uint8(FalaVault.Reason.NONE));
    }

    // T28: no sequence of spends + approvals can move more than dailyCap in one UTC day
    function testFuzz_neverExceedsDailyCap(uint256[12] memory amounts, uint8[12] memory who, bool[12] memory approveIt)
        public
    {
        // keep inside a single UTC day
        vm.warp((block.timestamp / 1 days) * 1 days + 1 hours);
        vm.prank(owner);
        vault.configureAgent(agent, _policy());
        address[3] memory payees = [vendorA, vendorB, attacker];
        uint256 maxId;
        for (uint256 i; i < 12; i++) {
            uint256 amt = amounts[i] % (4 * ONE);
            (uint8 o, uint256 id) = _spend(payees[who[i] % 3], amt, "fuzz");
            if (o == 2) {
                maxId = id;
                if (approveIt[i]) {
                    vm.prank(auditor);
                    vault.approve(id);
                }
            }
        }
        assertLe(usdc.balanceOf(vendorA) + usdc.balanceOf(vendorB), 5 * ONE);
        assertEq(usdc.balanceOf(attacker), 0);
        maxId;
    }

    function test_ownable2Step() public {
        vm.prank(owner);
        vault.transferOwnership(stranger);
        assertEq(vault.owner(), owner);
        vm.prank(stranger);
        vault.acceptOwnership();
        assertEq(vault.owner(), stranger);
    }

    function test_pendingTtlConfigurable() public {
        vm.prank(owner);
        vault.setPendingTtl(10 minutes);
        (, uint256 id) = _spend(vendorB, 2 * ONE, "plan");
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(auditor);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendorB), 0);
    }
}
