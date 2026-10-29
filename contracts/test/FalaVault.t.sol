// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FalaVault} from "../src/FalaVault.sol";
import "../src/FalaVault.sol"; // file-level errors
import "../src/DkimVerifier.sol";

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

/// USDC whose `transfer` tries to re-enter the vault while the vault is paying out.
contract ReentrantUSDC is MockUSDC {
    FalaVault public target;
    bytes public blk;
    bytes public sig;
    uint256 public cancelId;
    bool public armed;
    bytes4[] public reasons; // revert selector of every re-entry attempt

    function arm(FalaVault v, bytes calldata b, bytes calldata s, uint256 id) external {
        target = v;
        blk = b;
        sig = s;
        cancelId = id;
        armed = true;
    }

    function reasonCount() external view returns (uint256) {
        return reasons.length;
    }

    function transfer(address to, uint256 amt) public override returns (bool) {
        if (armed) {
            armed = false;
            try target.approveByEmail(blk, sig) {
                reasons.push(bytes4(0));
            } catch (bytes memory r) {
                reasons.push(bytes4(r));
            }
            try target.request(to, 1, "re-enter") {
                reasons.push(bytes4(0));
            } catch (bytes memory r) {
                reasons.push(bytes4(r));
            }
            try target.cancel(cancelId) {
                reasons.push(bytes4(0));
            } catch (bytes memory r) {
                reasons.push(bytes4(r));
            }
        }
        return super.transfer(to, amt);
    }
}

/// Exposes the library for the real-Gmail fixture test.
contract DkimHarness {
    function run(bytes calldata block_, bytes calldata sig, bytes calldata n, bytes calldata e)
        external
        view
        returns (bool ok, DkimVerifier.DkimResult memory r)
    {
        r = DkimVerifier.parse(block_);
        ok = DkimVerifier.verify(block_, sig, n, e);
    }
}

/// Fixtures come from `script/sign-email.mjs` (throwaway RSA key standing in for Gmail) via `vm.ffi`: run `forge test`
/// with ffi enabled (already set in foundry.toml). Every case below builds a fresh signed header block.
contract FalaVaultTest is Test {
    FalaVault vault;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address vendor = makeAddr("vendor");
    address stranger = makeAddr("stranger");
    address relayer = makeAddr("relayer");

    uint256 constant ONE = 1e6;
    uint64 constant T0 = 1_800_000_000;
    string constant APPROVER = "approver@gmail.com";
    string constant APPROVER_FROM = "Fala Approver <approver@gmail.com>";

    event AutoPaid(address indexed agent, address indexed payee, uint256 amount6, string memo);
    event IntentCreated(
        uint256 indexed id, address indexed agent, address indexed payee, uint256 amount6, bytes4 code, uint40 expiresAt, string memo
    );
    event IntentRejected(address indexed agent, address indexed payee, uint256 amount6, uint8 reason);
    event EmailApproved(uint256 indexed id, bytes32 indexed keyId, uint64 dkimT, address relayer);
    event EmailDenied(uint256 indexed id, bytes32 indexed keyId, uint64 dkimT);
    event EmailFrozen(bytes32 indexed keyId, uint64 dkimT);
    event Paid(uint256 indexed id, address indexed payee, uint256 amount6);
    event PayoutFailed(uint256 indexed id, address indexed payee, uint256 amount6);
    event IntentClosed(uint256 indexed id, FalaVault.Status status);
    event Deposited(address indexed from, uint256 amount6);

    // ------------------------------------------------------------------ helpers

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUSDC();
        (bytes memory n, bytes memory e) = _key("A");
        vault = new FalaVault(address(usdc), owner, APPROVER, "gmail.com", "test", n, e);
        usdc.mint(address(vault), 10 * ONE);

        vm.startPrank(owner);
        vault.setAgent(agent, 200_000, 1_000_000, 5_000_000, true);
        vault.setPayee(vendor, true);
        vm.stopPrank();
    }

    function _ffi(string memory json) internal returns (bytes memory) {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "script/sign-email.mjs";
        cmd[2] = json;
        return vm.ffi(cmd);
    }

    function _key(string memory name) internal returns (bytes memory n, bytes memory e) {
        (n, e) = abi.decode(_ffi(string.concat('{"mode":"key","key":"', name, '"}')), (bytes, bytes));
    }

    function _sign(string memory json) internal returns (bytes memory blk, bytes memory sig) {
        (blk, sig) = abi.decode(_ffi(json), (bytes, bytes));
    }

    /// extra: raw JSON members starting with a comma, e.g. `,"from":"x"`
    function _mail(string memory subject, uint256 t, string memory extra) internal returns (bytes memory, bytes memory) {
        return _sign(string.concat('{"key":"A","subject":"', subject, '","t":', vm.toString(t), extra, "}"));
    }

    function _ask(uint64 amount) internal returns (uint256 id) {
        vm.prank(agent);
        (FalaVault.Status s, uint256 i) = vault.request(vendor, amount, "annual API plan");
        assertEq(uint8(s), uint8(FalaVault.Status.PENDING));
        return i;
    }

    function _approveMail(uint256 id) internal returns (bytes memory, bytes memory) {
        return _mail(vault.subjectFor(id, 1), block.timestamp, "");
    }

    function _status(uint256 id) internal view returns (FalaVault.Status st) {
        (,,,,, st,,) = vault.intents(id);
    }

    /// approveByEmail and checkEmail must refuse with the same named error.
    function _refused(bytes4 sel, bytes memory blk, bytes memory sig) internal {
        vm.expectRevert(sel);
        vault.checkEmail(blk, sig);
        vm.expectRevert(sel);
        vault.approveByEmail(blk, sig);
    }

    // ------------------------------------------------------------------ funds (T1, T2)

    function test_T1_depositIsPayableAndScaled() public {
        vm.deal(stranger, 5 ether);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposited(stranger, 1_500_000);
        vm.prank(stranger);
        vault.deposit{value: 1.5 ether}();
    }

    function test_T1_depositRejectsBadValues() public {
        vm.deal(stranger, 5 ether);
        vm.startPrank(stranger);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.deposit{value: 1.5 ether + 1}();
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.deposit{value: 0}();
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        vm.stopPrank();
    }

    function test_T1_plainSendRevertsUseDeposit() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(UseDeposit.selector);
        payable(address(vault)).transfer(1 ether);
    }

    function test_T2_withdraw() public {
        vm.prank(owner);
        vault.withdraw(owner, 3 * ONE);
        assertEq(usdc.balanceOf(owner), 3 * ONE);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.withdraw(stranger, 1);
    }

    // ------------------------------------------------------------------ agent policy (T3 - T8)

    function test_T3_autoPay() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit AutoPaid(agent, vendor, 150_000, "dataset");
        vm.prank(agent);
        (FalaVault.Status s,) = vault.request(vendor, 150_000, "dataset");
        assertEq(uint8(s), uint8(FalaVault.Status.AUTO_PAID));
        assertEq(usdc.balanceOf(vendor), 150_000);
    }

    function test_T4_unknownPayeeBecomesIntent() public {
        vm.prank(agent);
        (FalaVault.Status s, uint256 id) = vault.request(stranger, 100_000, "new vendor");
        assertEq(uint8(s), uint8(FalaVault.Status.PENDING));
        assertEq(id, 1);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_T5_overAutoPerTxBecomesIntent() public {
        uint256 id = _ask(2 * uint64(ONE));
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(bytes(vault.subjectFor(id, 1)).length, bytes("FALA APPROVE 1 deadbeef").length);
    }

    function test_T6_dailyAllowanceExhausted() public {
        for (uint256 i; i < 5; i++) {
            vm.prank(agent);
            (FalaVault.Status s,) = vault.request(vendor, 200_000, "x");
            assertEq(uint8(s), uint8(FalaVault.Status.AUTO_PAID));
        }
        vm.prank(agent);
        (FalaVault.Status s2,) = vault.request(vendor, 100_000, "x");
        assertEq(uint8(s2), uint8(FalaVault.Status.PENDING));
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        (FalaVault.Status s3,) = vault.request(vendor, 100_000, "x");
        assertEq(uint8(s3), uint8(FalaVault.Status.AUTO_PAID));
    }

    function test_T7_overHardCapIsRejectedNotQueued() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(agent, vendor, 6 * ONE, 4);
        vm.prank(agent);
        (FalaVault.Status s, uint256 id) = vault.request(vendor, uint64(6 * ONE), "big");
        assertEq(uint8(s), uint8(FalaVault.Status.NONE));
        assertEq(id, 0);
        assertEq(vault.nextIntentId(), 1);
    }

    function test_T8_nonAgentAndBadInputAreRejectedWithoutRevert() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(stranger, vendor, ONE, 1);
        vm.prank(stranger);
        vault.request(vendor, uint64(ONE), "x");

        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(agent, vendor, 0, 3);
        vm.prank(agent);
        vault.request(vendor, 0, "zero");

        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(agent, address(0), ONE, 3);
        vm.prank(agent);
        vault.request(address(0), uint64(ONE), "zero address");
    }

    function test_agentCannotBeOwner() public {
        vm.prank(owner);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.setAgent(owner, 1, 1, 1, true);
        vm.prank(owner);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.setAgent(agent, 2, 2, 1, true); // autoPerTx > hardCap
    }

    function test_cancelAndExpire() public {
        uint256 id = _ask(2 * uint64(ONE));
        vm.prank(stranger);
        vm.expectRevert(FalaVault.NotAllowed.selector);
        vault.cancel(id);
        vm.prank(agent);
        vault.cancel(id);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.CANCELLED));

        uint256 id2 = _ask(2 * uint64(ONE));
        vm.expectRevert(FalaVault.NotExpired.selector);
        vault.expire(id2);
        vm.warp(block.timestamp + 1 hours + 1);
        vault.expire(id2);
        assertEq(uint8(_status(id2)), uint8(FalaVault.Status.EXPIRED));
    }

    // ------------------------------------------------------------------ email approval (T9 - T13)

    function test_T9_validApprove() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        (uint8 verb, uint256 checkedId) = vault.checkEmail(blk, sig);
        assertEq(verb, 1);
        assertEq(checkedId, id);

        vm.expectEmit(true, false, false, false, address(vault));
        emit EmailApproved(id, bytes32(0), 0, relayer);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Paid(id, vendor, 2 * ONE);
        vm.prank(relayer);
        uint256 g = gasleft();
        vault.approveByEmail(blk, sig);
        console.log("T33 approveByEmail gas (synthetic fixture):", g - gasleft());

        assertEq(usdc.balanceOf(vendor), 2 * ONE);
        assertEq(usdc.balanceOf(relayer), 20_000);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.APPROVED));
    }

    function test_T9_replyPrefixIsTolerated() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) =
            _mail(string.concat("Re: ", vault.subjectFor(id, 1)), block.timestamp, "");
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    function test_T10_validDeny() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 2), block.timestamp, "");
        vm.expectEmit(true, false, false, false, address(vault));
        emit EmailDenied(id, bytes32(0), 0);
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.DENIED));
    }

    function test_T11_freeze() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory fb, bytes memory fs_) = _mail(vault.subjectFor(0, 3), block.timestamp, "");
        vm.expectEmit(false, false, false, false, address(vault));
        emit EmailFrozen(bytes32(0), 0);
        vault.approveByEmail(fb, fs_);
        assertTrue(vault.frozen());

        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(agent, vendor, 100_000, 2);
        vm.prank(agent);
        vault.request(vendor, 100_000, "x");

        (bytes memory blk, bytes memory sig) = _approveMail(id);
        _refused(Frozen.selector, blk, sig);

        vm.prank(owner);
        vault.unfreeze();
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    function test_T12_replayApprove() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vault.approveByEmail(blk, sig);
        _refused(IntentNotPending.selector, blk, sig);
    }

    function test_T13_replayOldFreeze() public {
        (bytes memory fb, bytes memory fs_) = _mail(vault.subjectFor(0, 3), block.timestamp, "");
        vault.approveByEmail(fb, fs_);
        vm.prank(owner);
        vault.unfreeze();
        _refused(StaleTimestamp.selector, fb, fs_);
        // an older email (t before the last freeze) is also refused
        (bytes memory ob, bytes memory os) = _mail(vault.subjectFor(0, 3), block.timestamp - 100, "");
        _refused(StaleTimestamp.selector, ob, os);
        // a newer one works
        (bytes memory nb, bytes memory ns) = _mail(vault.subjectFor(0, 3), block.timestamp + 1, "");
        vault.approveByEmail(nb, ns);
        assertTrue(vault.frozen());
    }

    // ------------------------------------------------------------------ the refusal room (T14 - T27)

    function test_T14_flippedByte() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"flipByte":50');
        _refused(BadSignature.selector, blk, sig);
    }

    function test_T15_otherKey() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) =
            _sign(string.concat('{"key":"B","subject":"', vault.subjectFor(id, 1), '","t":', vm.toString(block.timestamp), "}"));
        _refused(BadSignature.selector, blk, sig);
    }

    function test_T16_otherSender() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) =
            _mail(vault.subjectFor(id, 1), block.timestamp, ',"from":"Mallory <mallory@gmail.com>"');
        _refused(FromNotApprover.selector, blk, sig);
    }

    function test_T16_displayNameCannotSpoofAddress() public {
        uint256 id = _ask(2 * uint64(ONE));
        // display name contains the approver's address; the real address is the last <...>
        (bytes memory blk, bytes memory sig) = _mail(
            vault.subjectFor(id, 1), block.timestamp, ',"from":"\\"x <approver@gmail.com>\\" <mallory@gmail.com>"'
        );
        _refused(FromNotApprover.selector, blk, sig);
        // and the legit angle-bracket form still works
        (bytes memory b2, bytes memory s2) =
            _mail(vault.subjectFor(id, 1), block.timestamp, ',"from":"\\"Approver\\" <APPROVER@Gmail.com>"');
        vault.approveByEmail(b2, s2); // case-insensitive
    }

    function test_BadFrom() public {
        uint256 id = _ask(2 * uint64(ONE));
        string[4] memory bad = [
            "approver@gmail.com, mallory@gmail.com",
            "<approver@gmail.com",
            "approver@@gmail.com",
            "no-at-sign"
        ];
        for (uint256 i; i < bad.length; i++) {
            (bytes memory blk, bytes memory sig) =
                _mail(vault.subjectFor(id, 1), block.timestamp, string.concat(',"from":"', bad[i], '"'));
            _refused(BadFrom.selector, blk, sig);
        }
    }

    function test_T17_domainMismatch() public {
        (bytes memory nB, bytes memory eB) = _key("B");
        vm.prank(owner);
        vault.proposeKey("other.com", "test", nB, eB);
        vm.warp(block.timestamp + 1 days);
        uint256 id = _ask(2 * uint64(ONE));
        // other.com really signed it, but the From is approver@gmail.com
        (bytes memory blk, bytes memory sig) = _sign(
            string.concat(
                '{"key":"B","d":"other.com","subject":"', vault.subjectFor(id, 1), '","t":', vm.toString(block.timestamp), "}"
            )
        );
        _refused(DomainMismatch.selector, blk, sig);
    }

    function test_T18_wrongCode() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) =
            _mail(string.concat("FALA APPROVE ", vm.toString(id), " 00000000"), block.timestamp, "");
        _refused(CodeMismatch.selector, blk, sig);
    }

    function test_T19_codeFromAnotherIntent() public {
        uint256 id1 = _ask(2 * uint64(ONE));
        uint256 id2 = _ask(3 * uint64(ONE));
        string memory s1 = vault.subjectFor(id1, 1); // "FALA APPROVE 1 <code1>"
        // reuse intent 1's code on intent 2
        bytes memory code1 = new bytes(8);
        bytes memory sb = bytes(s1);
        for (uint256 i; i < 8; i++) {
            code1[i] = sb[sb.length - 8 + i];
        }
        (bytes memory blk, bytes memory sig) =
            _mail(string.concat("FALA APPROVE ", vm.toString(id2), " ", string(code1)), block.timestamp, "");
        _refused(CodeMismatch.selector, blk, sig);
    }

    function test_T20_subjectMustMatchGrammar() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory good = vault.subjectFor(id, 1);
        string[8] memory bad = [
            "hello",
            "FALA APPROVE 1 DEADBEEF",
            string.concat(good, " extra"),
            "FALA APPROVE 01 deadbeef",
            "FALA  APPROVE 1 deadbeef",
            "fala approve 1 deadbeef",
            "FALA APPROVE 1",
            "FALA FREEZE 1 0"
        ];
        for (uint256 i; i < bad.length; i++) {
            (bytes memory blk, bytes memory sig) = _mail(bad[i], block.timestamp, "");
            _refused(SubjectMalformed.selector, blk, sig);
        }
    }

    function test_T21_twoFromLines() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory lines = string.concat(
            ',"lines":["from:', APPROVER_FROM, '","from:mallory@gmail.com","subject:', vault.subjectFor(id, 1), '"]'
        );
        (bytes memory blk, bytes memory sig) = _sign(string.concat('{"key":"A","t":', vm.toString(block.timestamp), lines, "}"));
        _refused(DuplicateHeader.selector, blk, sig);
    }

    function test_T22_fromHiddenInsideSubject() public {
        uint256 id = _ask(2 * uint64(ONE));
        // the subject value contains "from:victim@gmail.com" but only a line-start "from:" counts
        string memory lines = string.concat(
            ',"lines":["from:', APPROVER_FROM, '","subject:x from:victim@gmail.com ', vault.subjectFor(id, 1), '"]'
        );
        (bytes memory blk, bytes memory sig) = _sign(string.concat('{"key":"A","t":', vm.toString(block.timestamp), lines, "}"));
        // From was taken from the real line (approver OK) so the refusal is about the subject, not the sender
        _refused(SubjectMalformed.selector, blk, sig);
    }

    function test_T23_dkimNotLast() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory b1, bytes memory s1) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"dkimNotLast":true');
        _refused(DkimNotLast.selector, b1, s1);
        (bytes memory b2, bytes memory s2) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"noDkim":true');
        _refused(DkimNotLast.selector, b2, s2);
    }

    function test_T24_wrongAlgorithm() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"a":"rsa-sha1"');
        _refused(WrongAlgorithm.selector, blk, sig);
        (bytes memory b2, bytes memory s2) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"c":"simple/simple"');
        _refused(WrongCanonicalization.selector, b2, s2);
    }

    function test_T25_subjectNotSigned() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"h":"from:to:date"');
        _refused(HeaderNotSigned.selector, blk, sig);
    }

    function test_malformedTags() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory subj = vault.subjectFor(id, 1);
        // duplicate d= tag
        (bytes memory b1, bytes memory s1) = _mail(
            subj, block.timestamp, ',"dkimTags":"v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; d=evil.com; s=test; h=from:subject; b="'
        );
        _refused(MalformedHeader.selector, b1, s1);
        // b= not emptied
        (bytes memory b2, bytes memory s2) = _mail(
            subj, block.timestamp, ',"dkimTags":"v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; h=from:subject; b=AAAA"'
        );
        _refused(MalformedHeader.selector, b2, s2);
        // tag whose name merely ends in d (bh=) must not be read as d=
        (bytes memory b3, bytes memory s3) = _mail(
            subj, block.timestamp, ',"dkimTags":"v=1; a=rsa-sha256; c=relaxed/relaxed; s=test; bh=gmail.com; h=from:subject; b="'
        );
        _refused(MalformedHeader.selector, b3, s3);
    }

    function test_T26_keyRegistry() public {
        uint256 id = _ask(2 * uint64(ONE));
        // unknown selector
        (bytes memory b1, bytes memory s1) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"s":"nope"');
        _refused(UnknownKey.selector, b1, s1);

        // key before its timelock
        (bytes memory nB, bytes memory eB) = _key("B");
        vm.prank(owner);
        vault.proposeKey("gmail.com", "next", nB, eB);
        (bytes memory b2, bytes memory s2) = _sign(
            string.concat('{"key":"B","s":"next","subject":"', vault.subjectFor(id, 1), '","t":', vm.toString(block.timestamp), "}")
        );
        _refused(KeyNotActive.selector, b2, s2);

        // revoked key
        bytes32 keyId = keccak256(abi.encode(keccak256("gmail.com"), keccak256("test")));
        vm.prank(owner);
        vault.revokeKey(keyId);
        (bytes memory b3, bytes memory s3) = _approveMail(id);
        _refused(KeyRevoked.selector, b3, s3);

        // after the timelock the new key works
        vm.warp(block.timestamp + 1 days);
        uint256 id2 = _ask(2 * uint64(ONE));
        (bytes memory b4, bytes memory s4) = _sign(
            string.concat('{"key":"B","s":"next","subject":"', vault.subjectFor(id2, 1), '","t":', vm.toString(block.timestamp), "}")
        );
        vault.approveByEmail(b4, s4);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    function test_keyProposalValidation() public {
        (bytes memory n, bytes memory e) = _key("A");
        vm.startPrank(owner);
        vm.expectRevert(FalaVault.KeyExists.selector);
        vault.proposeKey("GMAIL.com", "TEST", n, e);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.proposeKey("gmail.com", "short", hex"0102", e);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.proposeKey("gmail.com", "x", n, e);
    }

    function test_setApproverNeedsAKnownDomain() public {
        vm.startPrank(owner);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.setApprover("someone@unknown.org");
        vault.setApprover("Second.Approver@Gmail.com");
        vm.stopPrank();
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id); // old approver now refused
        _refused(FromNotApprover.selector, blk, sig);
    }

    function test_T27_emailSignedBeforeIntent() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 1), block.timestamp - 10 minutes, "");
        _refused(StaleTimestamp.selector, blk, sig);
        (bytes memory b2, bytes memory s2) = _mail(vault.subjectFor(id, 1), block.timestamp + 2 hours, "");
        _refused(StaleTimestamp.selector, b2, s2);
    }

    // ------------------------------------------------------------------ expiry & payout failure (T28, T29)

    function test_T28_approveAfterTtl() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(id, 1), block.timestamp + 10, "");
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(IntentExpired.selector);
        vault.checkEmail(blk, sig);
        vm.expectEmit(true, false, false, true, address(vault));
        emit IntentClosed(id, FalaVault.Status.EXPIRED);
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.EXPIRED));
    }

    function test_T29_blocklistedPayee() public {
        uint256 id = _ask(2 * uint64(ONE));
        usdc.blocklist(vendor, true);
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutFailed(id, vendor, 2 * ONE);
        vault.approveByEmail(blk, sig);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.FAILED));
        assertEq(usdc.balanceOf(address(vault)), 10 * ONE);
    }

    function test_relayerTipBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.setParams(1 hours, 50_001);
        vault.setParams(2 hours, 0);
        vm.stopPrank();
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vm.prank(relayer);
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    // ------------------------------------------------------------------ real Gmail fixture (T31) & fuzz (T32)

    function test_T31_realGmailFixture() public {
        if (!vm.exists("test/fixtures/gmail-real.json")) {
            console.log("T31 skipped: add test/fixtures/gmail-real.json");
            vm.skip(true);
        }
        string memory j = vm.readFile("test/fixtures/gmail-real.json");
        bytes memory blk = vm.parseJsonBytes(j, ".block");
        bytes memory sig = vm.parseJsonBytes(j, ".sig");
        bytes memory n = vm.parseJsonBytes(j, ".n");
        bytes memory e = vm.parseJsonBytes(j, ".e");
        DkimHarness h = new DkimHarness();
        uint256 g = gasleft();
        (bool ok, DkimVerifier.DkimResult memory r) = h.run(blk, sig, n, e);
        console.log("T33 verify gas (real Gmail fixture):", g - gasleft());
        assertTrue(ok, "real Gmail signature must verify");
        assertEq(r.domainHash, keccak256("gmail.com"));
        assertEq(r.fromHash, keccak256(bytes(vm.parseJsonString(j, ".from"))));
        assertEq(string(r.subject), vm.parseJsonString(j, ".subject"));
    }

    function testFuzz_T32_randomBlockNeverPays(bytes calldata blk, bytes calldata sig) public {
        uint256 id = _ask(2 * uint64(ONE));
        try vault.approveByEmail(blk, sig) {} catch {}
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(usdc.balanceOf(address(vault)), 10 * ONE);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.PENDING));
    }

    // ================================================================== security-review regression tests

    function _from(string memory fromHeader) internal pure returns (string memory) {
        return string.concat(',"from":"', fromHeader, '"');
    }

    /// S1: an address hidden in a comment / second mailbox must never be read as the sender.
    function test_S1_fromCommentOrListCannotSpoofApprover() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory subj = vault.subjectFor(id, 1);
        string[7] memory bad = [
            "mallory@gmail.com (<approver@gmail.com>)",
            "Mallory <mallory@gmail.com> (<approver@gmail.com>)",
            "Mallory <mallory@gmail.com>, <approver@gmail.com>",
            "Mallory <mallory@gmail.com> <approver@gmail.com>",
            "<mallory@gmail.com(<approver@gmail.com>)>",
            "\\\"unterminated <approver@gmail.com>",
            "\\\"x\\\\\\\" <approver@gmail.com>\\\" <mallory@gmail.com> junk"
        ];
        for (uint256 i; i < bad.length; i++) {
            (bytes memory blk, bytes memory sig) = _mail(subj, block.timestamp, _from(bad[i]));
            _refused(BadFrom.selector, blk, sig);
        }
        // a quoted display name with commas and angle brackets is still fine
        (bytes memory b2, bytes memory s2) =
            _mail(subj, block.timestamp, _from("\\\"Doe, <Jane>\\\" <approver@gmail.com>"));
        vault.approveByEmail(b2, s2);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    /// S2: a signature without t= cannot skip the "signed after the intent existed" check.
    function test_S2_missingSigningTimeRejected() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory a, bytes memory sa) = _mail(vault.subjectFor(id, 1), block.timestamp, ',"noT":true');
        _refused(StaleTimestamp.selector, a, sa);
        (bytes memory d, bytes memory sd) = _mail(vault.subjectFor(id, 2), block.timestamp, ',"noT":true');
        _refused(StaleTimestamp.selector, d, sd);
        (bytes memory f, bytes memory sf) = _mail(vault.subjectFor(0, 3), block.timestamp, ',"noT":true');
        _refused(StaleTimestamp.selector, f, sf);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.PENDING));
        assertFalse(vault.frozen());
    }

    /// S3: FREEZE is bound to time: not stale, not from the future, and a bad t cannot poison lastFreezeT.
    function test_S3_freezeFreshnessWindow() public {
        (bytes memory old_, bytes memory so) = _mail(vault.subjectFor(0, 3), block.timestamp - 1 days - 1, "");
        _refused(StaleTimestamp.selector, old_, so);
        (bytes memory fut, bytes memory sf) = _mail(vault.subjectFor(0, 3), block.timestamp + 301, "");
        _refused(StaleTimestamp.selector, fut, sf);
        (bytes memory far, bytes memory sr) = _mail(vault.subjectFor(0, 3), block.timestamp + 3650 days, "");
        _refused(StaleTimestamp.selector, far, sr);
        assertEq(vault.lastFreezeT(), 0);

        // a genuine freeze still works afterwards; the edges of the window are inclusive
        (bytes memory edge, bytes memory se) = _mail(vault.subjectFor(0, 3), block.timestamp - 1 days, "");
        vault.approveByEmail(edge, se);
        assertTrue(vault.frozen());
        vm.prank(owner);
        vault.unfreeze();
        (bytes memory top, bytes memory st) = _mail(vault.subjectFor(0, 3), block.timestamp + 300, "");
        vault.approveByEmail(top, st);
        assertTrue(vault.frozen());
        assertEq(vault.lastFreezeT(), T0 + 300);
    }

    /// S4: the USDC address must be a contract (a call to an empty address would "succeed").
    function test_S4_constructorRejectsCodelessUsdc() public {
        (bytes memory n, bytes memory e) = _key("A");
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        new FalaVault(address(0xdead), owner, APPROVER, "gmail.com", "test", n, e);
    }

    /// S5: an auto-pay that fails emits PayoutFailed, does not revert, and does not burn the daily allowance.
    function test_S5_autoPayFailureEmitsPayoutFailedAndKeepsAllowance() public {
        usdc.blocklist(vendor, true);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutFailed(0, vendor, 150_000);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IntentRejected(agent, vendor, 150_000, 5);
        vm.prank(agent);
        (FalaVault.Status s, uint256 id) = vault.request(vendor, 150_000, "x");
        assertEq(uint8(s), uint8(FalaVault.Status.NONE));
        assertEq(id, 0);
        (,,,,, uint64 spent) = vault.agents(agent);
        assertEq(spent, 0);

        usdc.blocklist(vendor, false);
        for (uint256 i; i < 5; i++) {
            vm.prank(agent);
            (FalaVault.Status ok,) = vault.request(vendor, 200_000, "x");
            assertEq(uint8(ok), uint8(FalaVault.Status.AUTO_PAID));
        }
    }

    /// S6: a failing relayer tip is reported, never fatal, and never undoes the approved payment.
    function test_S6_tipFailureEmitsPayoutFailedButApprovalStands() public {
        uint256 id = _ask(2 * uint64(ONE));
        usdc.blocklist(relayer, true);
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutFailed(id, relayer, 20_000);
        vm.prank(relayer);
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.APPROVED));
    }

    /// S7: the token (or payee) cannot re-enter approveByEmail / request / cancel during the payout.
    function test_S7_reentrancyDuringPayout() public {
        ReentrantUSDC rt = new ReentrantUSDC();
        (bytes memory n, bytes memory e) = _key("A");
        FalaVault v = new FalaVault(address(rt), owner, APPROVER, "gmail.com", "test", n, e);
        rt.mint(address(v), 10 * ONE);
        vm.startPrank(owner);
        v.setAgent(agent, 200_000, 1_000_000, 5_000_000, true);
        v.setPayee(vendor, true);
        vm.stopPrank();
        vm.prank(agent);
        (, uint256 id) = v.request(vendor, uint64(2 * ONE), "big");

        (bytes memory blk, bytes memory sig) = _mail(v.subjectFor(id, 1), block.timestamp, "");
        rt.arm(v, blk, sig, id);
        v.approveByEmail(blk, sig);

        assertEq(rt.balanceOf(vendor), 2 * ONE, "paid exactly once");
        assertEq(rt.reasonCount(), 3);
        assertEq(rt.reasons(0), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rt.reasons(1), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rt.reasons(2), FalaVault.NotAllowed.selector); // cancel is unguarded, but only the agent/owner may call it
    }

    /// S8: whoever relays gets the same outcome; only the tip recipient differs.
    function testFuzz_S8_relayerCannotChangeOutcome(address who) public {
        vm.assume(who != address(0) && who != address(vault) && who != vendor && who != address(usdc));
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vm.prank(who);
        vault.approveByEmail(blk, sig);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
        assertEq(usdc.balanceOf(who), 20_000);
        assertEq(usdc.balanceOf(address(vault)), 10 * ONE - 2 * ONE - 20_000);
        assertEq(uint8(_status(id)), uint8(FalaVault.Status.APPROVED));
    }

    /// S9: a relayer that under-gasses the call can only make it revert; it can never turn an approval into FAILED.
    function test_S9_underGassedRelayCannotStrandApproval() public {
        uint256 id = _ask(2 * uint64(ONE));
        (bytes memory blk, bytes memory sig) = _approveMail(id);
        bool landed;
        uint256 reverted;
        for (uint256 g = 100_000; g <= 2_000_000; g += 10_000) {
            (bool ok,) = address(vault).call{gas: g}(abi.encodeCall(vault.approveByEmail, (blk, sig)));
            if (!ok) {
                reverted++;
                assertEq(uint8(_status(id)), uint8(FalaVault.Status.PENDING));
                continue;
            }
            assertEq(uint8(_status(id)), uint8(FalaVault.Status.APPROVED));
            landed = true;
            break;
        }
        assertTrue(landed);
        assertGt(reverted, 0);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    function _lines(string memory body) internal returns (bytes memory, bytes memory) {
        return _sign(string.concat('{"key":"A","t":', vm.toString(block.timestamp), ',"lines":[', body, "]}"));
    }

    /// S10a: duplicate / misplaced / look-alike headers.
    function test_S10a_duplicateAndLookalikeHeaders() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory fromL = string.concat('"from:', APPROVER_FROM, '"');
        string memory subjL = string.concat('"subject:', vault.subjectFor(id, 1), '"');

        // two Subject lines
        (bytes memory b1, bytes memory s1) = _lines(string.concat(fromL, ",", subjL, ",", subjL));
        _refused(DuplicateHeader.selector, b1, s1);

        // a DKIM-Signature line that is not the last line
        string memory dk = '"dkim-signature:v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; h=from:subject; b="';
        (bytes memory b2, bytes memory s2) = _lines(string.concat(fromL, ",", subjL, ",", dk));
        _refused(DuplicateHeader.selector, b2, s2);

        // a header whose name merely ends in "from" does not count, and does not shadow the real one
        (bytes memory b6, bytes memory s6) = _lines(string.concat('"x-from:mallory@gmail.com",', fromL, ",", subjL));
        (uint8 verb,) = vault.checkEmail(b6, s6);
        assertEq(verb, 1);
    }

    /// S10b: line endings.
    function test_S10b_lineEndings() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory subj = vault.subjectFor(id, 1);
        (bytes memory b3, bytes memory s3) = _mail(string.concat(subj, "\\nfrom:mallory@gmail.com"), block.timestamp, "");
        _refused(MalformedHeader.selector, b3, s3);
        (bytes memory b4, bytes memory s4) = _mail(string.concat(subj, "\\rfrom:mallory@gmail.com"), block.timestamp, "");
        _refused(MalformedHeader.selector, b4, s4);
        // block ends with CRLF after the DKIM line
        (bytes memory b5, bytes memory s5) = _mail(
            subj,
            block.timestamp,
            ',"dkimTags":"v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; h=from:subject; b=\\r\\n"'
        );
        _refused(DkimNotLast.selector, b5, s5);
    }

    /// S10c: h= coverage and mandatory tags.
    function test_S10c_hCoverageAndMandatoryTags() public {
        uint256 id = _ask(2 * uint64(ONE));
        string memory subj = vault.subjectFor(id, 1);
        // h= is matched case-insensitively; subject missing from h= is refused
        (bytes memory b7, bytes memory s7) = _mail(subj, block.timestamp, ',"h":"FROM:Subject"');
        vault.checkEmail(b7, s7);
        (bytes memory b8, bytes memory s8) = _mail(subj, block.timestamp, ',"h":"from:to:date"');
        _refused(HeaderNotSigned.selector, b8, s8);
        (bytes memory b9, bytes memory s9) = _mail(subj, block.timestamp, ',"h":"subject:to:date"');
        _refused(HeaderNotSigned.selector, b9, s9);

        string[3] memory broken = [
            "v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; h=from:subject", // no b=
            "a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; h=from:subject; b=", // no v=
            "v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=test; t=12x; h=from:subject; b=" // bad t=
        ];
        for (uint256 i; i < broken.length; i++) {
            (bytes memory bb, bytes memory sb) =
                _mail(subj, block.timestamp, string.concat(',"dkimTags":"', broken[i], '"'));
            _refused(MalformedHeader.selector, bb, sb);
        }
    }

    /// S11: subject grammar edges.
    function test_S11_subjectGrammarEdges() public {
        _ask(2 * uint64(ONE));
        string[8] memory bad = [
            "Re: Re: FALA APPROVE 1 deadbeef",
            "FALA APPROVE 0 deadbeef",
            "FALA APPROVE 99999999999999999999 deadbeef",
            "FALA APPROVE 1 deadbee",
            "FALA APPROVE 1 deadbeeg",
            "FALA FREEZE 0 00",
            "FALA DENY 1 deadbeef0",
            "FALA OPEN 1 deadbeef"
        ];
        for (uint256 i; i < bad.length; i++) {
            (bytes memory blk, bytes memory sig) = _mail(bad[i], block.timestamp, "");
            _refused(SubjectMalformed.selector, blk, sig);
        }
        // padding and an upper/lower-case reply prefix are tolerated
        uint256 id = 1;
        (bytes memory b, bytes memory s_) =
            _mail(string.concat("  RE:   ", vault.subjectFor(id, 2), "  "), block.timestamp, "");
        (uint8 verb,) = vault.checkEmail(b, s_);
        assertEq(verb, 2);
    }

    /// S12: every terminal state is final, whatever email arrives later.
    function test_S12_terminalStatesAreFinal() public {
        uint256 d = _ask(2 * uint64(ONE));
        (bytes memory deny, bytes memory sd) = _mail(vault.subjectFor(d, 2), block.timestamp, "");
        vault.approveByEmail(deny, sd);
        (bytes memory ap, bytes memory sa) = _approveMail(d);
        _refused(IntentNotPending.selector, ap, sa);
        _refused(IntentNotPending.selector, deny, sd);

        uint256 c = _ask(2 * uint64(ONE));
        vm.prank(agent);
        vault.cancel(c);
        (bytes memory ap2, bytes memory sa2) = _approveMail(c);
        _refused(IntentNotPending.selector, ap2, sa2);

        uint256 a = _ask(2 * uint64(ONE));
        (bytes memory ap3, bytes memory sa3) = _approveMail(a);
        vault.approveByEmail(ap3, sa3);
        vm.prank(agent);
        vm.expectRevert(FalaVault.NotPending.selector);
        vault.cancel(a);
        vm.expectRevert(FalaVault.NotPending.selector);
        vault.expire(a);
        (bytes memory dn, bytes memory sdn) = _mail(vault.subjectFor(a, 2), block.timestamp, "");
        _refused(IntentNotPending.selector, dn, sdn);
        assertEq(usdc.balanceOf(vendor), 2 * ONE);
    }

    /// S13: a reply for an intent id that does not exist is refused, never paid.
    function test_S13_unknownIntentId() public {
        (bytes memory blk, bytes memory sig) = _mail("FALA APPROVE 7 deadbeef", block.timestamp, "");
        _refused(IntentNotPending.selector, blk, sig);
    }

    /// S14: key timelock is exact; revocation is immediate; only the owner can revoke.
    function test_S14_keyTimelockAndRevocation() public {
        (bytes memory nB, bytes memory eB) = _key("B");
        vm.prank(owner);
        vault.proposeKey("gmail.com", "next", nB, eB);
        vm.prank(owner);
        vault.setParams(3 days, 20_000); // keep the intent alive across the timelock
        uint256 id = _ask(2 * uint64(ONE));
        string memory sj = vault.subjectFor(id, 1);

        vm.warp(block.timestamp + 1 days - 1);
        (bytes memory b1, bytes memory s1) = _sign(
            string.concat('{"key":"B","s":"next","subject":"', sj, '","t":', vm.toString(block.timestamp), "}")
        );
        _refused(KeyNotActive.selector, b1, s1);

        vm.warp(block.timestamp + 1);
        (bytes memory b2, bytes memory s2) = _sign(
            string.concat('{"key":"B","s":"next","subject":"', sj, '","t":', vm.toString(block.timestamp), "}")
        );
        vault.checkEmail(b2, s2);

        bytes32 nextId = keccak256(abi.encode(keccak256("gmail.com"), keccak256("next")));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.revokeKey(nextId);
        vm.prank(owner);
        vault.revokeKey(nextId);
        _refused(KeyRevoked.selector, b2, s2);

        vm.prank(owner);
        vm.expectRevert(UnknownKey.selector);
        vault.revokeKey(bytes32(uint256(1)));
        assertEq(vault.getKeyIds().length, 2);
    }

    /// S15: an approval for one vault can never be replayed on another vault or chain, even with the same key and id.
    function test_S15_codeBoundToVaultAndChain() public {
        (bytes memory n, bytes memory e) = _key("A");
        FalaVault v2 = new FalaVault(address(usdc), owner, APPROVER, "gmail.com", "test", n, e);
        usdc.mint(address(v2), 10 * ONE);
        vm.startPrank(owner);
        v2.setAgent(agent, 200_000, 1_000_000, 5_000_000, true);
        v2.setPayee(vendor, true);
        vm.stopPrank();

        uint256 id = _ask(2 * uint64(ONE));
        vm.prank(agent);
        (, uint256 id2) = v2.request(vendor, uint64(2 * ONE), "annual API plan");
        assertEq(id, id2);
        assertTrue(vault.codeOf(id) != v2.codeOf(id2), "same intent, different vault => different code");

        (bytes memory blk, bytes memory sig) = _approveMail(id);
        vm.expectRevert(CodeMismatch.selector);
        v2.approveByEmail(blk, sig);

        uint256 snap = vm.snapshotState();
        vm.chainId(999);
        uint256 other = _ask(2 * uint64(ONE));
        assertTrue(vault.codeOf(other) != vault.codeOf(id));
        vm.revertToState(snap);
    }

    /// S16: however the agent behaves inside one day, auto-pay never exceeds the daily allowance, and nothing reverts.
    function testFuzz_S16_autoSpendNeverExceedsDailyAllowance(uint64[12] calldata amounts) public {
        for (uint256 i; i < amounts.length; i++) {
            vm.prank(agent);
            vault.request(vendor, amounts[i], "f");
        }
        assertLe(usdc.balanceOf(vendor), 1_000_000);
        (,,,,, uint64 spent) = vault.agents(agent);
        assertEq(spent, usdc.balanceOf(vendor));
    }

    event Withdrawn(address indexed to, uint256 amount6);

    /// S17: a FREEZE email is bound to one vault and chain.
    function test_S17_freezeBoundToVaultAndChain() public {
        (bytes memory n, bytes memory e) = _key("A");
        FalaVault v2 = new FalaVault(address(usdc), owner, APPROVER, "gmail.com", "test", n, e);
        assertTrue(vault.freezeCode() != v2.freezeCode());

        (bytes memory blk, bytes memory sig) = _mail(vault.subjectFor(0, 3), block.timestamp, "");
        vm.expectRevert(CodeMismatch.selector);
        v2.approveByEmail(blk, sig);
        vm.expectRevert(CodeMismatch.selector);
        v2.checkEmail(blk, sig);
        assertFalse(v2.frozen());

        // the old unbound subject is no longer a valid FREEZE
        (bytes memory ob, bytes memory os) = _mail("FALA FREEZE 0 0", block.timestamp, "");
        _refused(SubjectMalformed.selector, ob, os);
        // a wrong code on the right vault
        (bytes memory wb, bytes memory ws) = _mail("FALA FREEZE 0 00000000", block.timestamp, "");
        _refused(CodeMismatch.selector, wb, ws);

        vault.approveByEmail(blk, sig);
        assertTrue(vault.frozen());

        // same address, other chain => other code
        uint256 snap = vm.snapshotState();
        bytes4 here = vault.freezeCode();
        vm.chainId(999);
        assertTrue(vault.freezeCode() != here);
        vm.revertToState(snap);
    }

    /// S18: ownership can be transferred (two-step) but never renounced.
    function test_S18_renounceOwnershipDisabled() public {
        vm.prank(owner);
        vm.expectRevert(FalaVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);

        vm.prank(owner);
        vault.transferOwnership(stranger);
        assertEq(vault.owner(), owner); // not effective until accepted
        vm.prank(stranger);
        vault.acceptOwnership();
        assertEq(vault.owner(), stranger);
    }

    /// S19: owner withdrawals follow the same payout rule: a token failure is an event, not a revert.
    function test_S19_withdrawNeverRevertsOnPayoutFailure() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit Withdrawn(owner, 4 * ONE);
        vm.prank(owner);
        vault.withdraw(owner, 4 * ONE);
        assertEq(usdc.balanceOf(owner), 4 * ONE);

        // more than the balance
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutFailed(0, owner, 100 * ONE);
        vm.prank(owner);
        vault.withdraw(owner, 100 * ONE);
        assertEq(usdc.balanceOf(address(vault)), 6 * ONE);

        // blocklisted recipient
        usdc.blocklist(stranger, true);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutFailed(0, stranger, ONE);
        vm.prank(owner);
        vault.withdraw(stranger, ONE);
        assertEq(usdc.balanceOf(address(vault)), 6 * ONE);

        // access control still reverts
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.withdraw(stranger, 1);
    }

    /// S20: the approver can only be moved to a domain that has a usable (active, not revoked) key.
    function test_S20_approverNeedsActiveKey() public {
        (bytes memory nB, bytes memory eB) = _key("B");
        vm.startPrank(owner);
        vault.proposeKey("other.com", "k1", nB, eB);
        vm.expectRevert(FalaVault.InvalidConfig.selector); // still inside the timelock
        vault.setApprover("boss@other.com");
        vm.warp(block.timestamp + 1 days);
        vault.setApprover("boss@other.com");

        // revoke it: moving (back) to a domain with only revoked keys is refused
        vault.revokeKey(keccak256(abi.encode(keccak256("other.com"), keccak256("k1"))));
        vm.expectRevert(FalaVault.InvalidConfig.selector);
        vault.setApprover("again@other.com");
        vault.setApprover("me@gmail.com");
        vm.stopPrank();
    }
}
