// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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
        (bytes memory fb, bytes memory fs_) = _mail("FALA FREEZE 0 0", block.timestamp, "");
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
        (bytes memory fb, bytes memory fs_) = _mail("FALA FREEZE 0 0", block.timestamp, "");
        vault.approveByEmail(fb, fs_);
        vm.prank(owner);
        vault.unfreeze();
        _refused(StaleTimestamp.selector, fb, fs_);
        // an older email (t before the last freeze) is also refused
        (bytes memory ob, bytes memory os) = _mail("FALA FREEZE 0 0", block.timestamp - 100, "");
        _refused(StaleTimestamp.selector, ob, os);
        // a newer one works
        (bytes memory nb, bytes memory ns) = _mail("FALA FREEZE 0 0", block.timestamp + 1, "");
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
            console.log("T31 skipped: add test/fixtures/gmail-real.json (see scripts/capture-fixture.ts)");
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
}
