// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";

error MalformedHeader();
error DkimNotLast();
error DuplicateHeader();
error MissingHeader();
error HeaderNotSigned();
error WrongAlgorithm();
error WrongCanonicalization();
error BadFrom();

/// @title DkimVerifier
/// @notice Parses a relaxed-canonicalized DKIM signed-header block (RFC 6376, a=rsa-sha256) and verifies its RSA signature.
/// @dev Relaxed canonicalization unfolds headers, so every CRLF in the block separates two headers and only line-start
///      matches count. The last line is the DKIM-Signature header itself with an empty `b=` and no trailing CRLF.
library DkimVerifier {
    struct DkimResult {
        bytes32 domainHash; // keccak256(lowercase d=)
        bytes32 selectorHash; // keccak256(lowercase s=)
        bytes32 fromHash; // keccak256(lowercase from address)
        bytes32 fromDomainHash; // keccak256(lowercase part after '@')
        uint64 t; // DKIM t= (unix seconds); 0 if absent
        bytes subject; // subject value (raw bytes)
    }

    bytes1 private constant SP = 0x20;
    bytes1 private constant CR = 0x0d;
    bytes1 private constant LF = 0x0a;

    /// @notice RSASSA-PKCS1-v1_5 / SHA-256 over the whole header block.
    function verify(bytes memory headerBlock, bytes memory sig, bytes memory n, bytes memory e)
        internal
        view
        returns (bool)
    {
        return RSA.pkcs1Sha256(sha256(headerBlock), sig, e, n);
    }

    function parse(bytes memory b) internal pure returns (DkimResult memory r) {
        uint256 len = b.length;
        if (len == 0) revert MalformedHeader();

        uint256 fromS;
        uint256 fromE;
        uint256 subjS;
        uint256 subjE;
        uint256 fromCount;
        uint256 subjCount;
        uint256 dkimS;
        bool dkimBeforeLast;

        uint256 start = 0;
        while (true) {
            uint256 end = _lineEnd(b, start);
            if (end == len) {
                dkimS = start;
                break;
            }
            if (_hasPrefix(b, start, end, "dkim-signature:")) dkimBeforeLast = true;
            else if (_hasPrefix(b, start, end, "from:")) {
                fromCount++;
                fromS = start + 5;
                fromE = end;
            } else if (_hasPrefix(b, start, end, "subject:")) {
                subjCount++;
                subjS = start + 8;
                subjE = end;
            }
            start = end + 2;
        }

        if (!_hasPrefix(b, dkimS, len, "dkim-signature:")) revert DkimNotLast();
        if (dkimBeforeLast) revert DuplicateHeader();
        if (fromCount == 0 || subjCount == 0) revert MissingHeader();
        if (fromCount > 1 || subjCount > 1) revert DuplicateHeader();

        _parseTags(b, dkimS + 15, len, r);
        _parseFrom(b, fromS, fromE, r);
        r.subject = _slice(b, subjS, subjE);
    }

    // ------------------------------------------------------------------ DKIM tags

    struct TagState {
        uint16 seen; // bit per tag: v a c d s t h b
        bool hasFrom;
        bool hasSubject;
    }

    function _parseTags(bytes memory b, uint256 s, uint256 e, DkimResult memory r) private pure {
        TagState memory st;

        uint256 seg = s;
        while (seg <= e) {
            uint256 segEnd = _indexOf(b, ";", seg, e);
            _parseSegment(b, seg, segEnd, st, r);
            seg = segEnd + 1;
        }

        // v, a, c, d, s, h, b are mandatory (t is optional)
        uint16 seen = st.seen;
        if (seen & 1 == 0 || seen & 128 == 0) revert MalformedHeader();
        if (seen & 2 == 0) revert WrongAlgorithm();
        if (seen & 4 == 0) revert WrongCanonicalization();
        if (seen & 8 == 0 || seen & 16 == 0) revert MalformedHeader();
        if (seen & 64 == 0 || !st.hasFrom || !st.hasSubject) revert HeaderNotSigned();
    }

    function _parseSegment(bytes memory b, uint256 s, uint256 e, TagState memory st, DkimResult memory r)
        private
        pure
    {
        (uint256 a, uint256 z) = _trim(b, s, e);
        if (a == z) return;
        uint256 eq = _indexOf(b, "=", a, z);
        if (eq == z) revert MalformedHeader();
        (uint256 na, uint256 nz) = _trim(b, a, eq);
        if (nz - na != 1) return; // bh, x, i, l, q, z ... are not needed
        (uint256 va, uint256 vz) = _trim(b, eq + 1, z);
        _applyTag(b, b[na], va, vz, st, r);
    }

    function _applyTag(bytes memory b, bytes1 tag, uint256 va, uint256 vz, TagState memory st, DkimResult memory r)
        private
        pure
    {
        if (tag == "v") {
            _mark(st, 0);
            if (!_eq(b, va, vz, "1")) revert MalformedHeader();
        } else if (tag == "a") {
            _mark(st, 1);
            if (!_eqLower(b, va, vz, "rsa-sha256")) revert WrongAlgorithm();
        } else if (tag == "c") {
            _mark(st, 2);
            if (!_eqLower(b, va, vz, "relaxed/relaxed") && !_eqLower(b, va, vz, "relaxed")) {
                revert WrongCanonicalization();
            }
        } else if (tag == "d") {
            _mark(st, 3);
            if (va == vz) revert MalformedHeader();
            r.domainHash = keccak256(_lower(_slice(b, va, vz)));
        } else if (tag == "s") {
            _mark(st, 4);
            if (va == vz) revert MalformedHeader();
            r.selectorHash = keccak256(_lower(_slice(b, va, vz)));
        } else if (tag == "t") {
            _mark(st, 5);
            r.t = _parseUint64(b, va, vz);
        } else if (tag == "h") {
            _mark(st, 6);
            (st.hasFrom, st.hasSubject) = _scanH(b, va, vz);
        } else if (tag == "b") {
            _mark(st, 7);
            if (va != vz) revert MalformedHeader(); // signature value must be emptied in the signed block
        }
    }

    function _mark(TagState memory st, uint8 bit) private pure {
        uint16 m = uint16(1) << bit;
        if (st.seen & m != 0) revert MalformedHeader(); // duplicate tag
        st.seen |= m;
    }

    function _scanH(bytes memory b, uint256 s, uint256 e) private pure returns (bool hasFrom, bool hasSubject) {
        uint256 p = s;
        while (p <= e) {
            uint256 q = _indexOf(b, ":", p, e);
            (uint256 a, uint256 z) = _trim(b, p, q);
            if (_eqLower(b, a, z, "from")) hasFrom = true;
            else if (_eqLower(b, a, z, "subject")) hasSubject = true;
            p = q + 1;
        }
    }

    // ------------------------------------------------------------------ From

    function _parseFrom(bytes memory b, uint256 s, uint256 e, DkimResult memory r) private pure {
        (uint256 a, uint256 z) = _trim(b, s, e);

        // the address is between the LAST '<' and the next '>' (display names may contain '<')
        uint256 lt = type(uint256).max;
        for (uint256 i = a; i < z; i++) {
            if (b[i] == "<") lt = i;
        }
        if (lt != type(uint256).max) {
            uint256 gt = _indexOf(b, ">", lt + 1, z);
            if (gt == z) revert BadFrom();
            a = lt + 1;
            z = gt;
        }
        if (z - a < 3) revert BadFrom();

        uint256 at = type(uint256).max;
        for (uint256 i = a; i < z; i++) {
            bytes1 c = b[i];
            if (c <= SP || c == "<" || c == ">" || c == "," || c == ";" || c == '"' || c == "(" || c == ")" || c > 0x7e) {
                revert BadFrom();
            }
            if (c == "@") {
                if (at != type(uint256).max) revert BadFrom();
                at = i;
            }
        }
        if (at == type(uint256).max || at == a || at + 1 == z) revert BadFrom();

        r.fromHash = keccak256(_lower(_slice(b, a, z)));
        r.fromDomainHash = keccak256(_lower(_slice(b, at + 1, z)));
    }

    // ------------------------------------------------------------------ byte helpers

    /// @dev End of the line starting at `start` (index of CRLF, or length if none). Bare CR / LF are rejected.
    function _lineEnd(bytes memory b, uint256 start) private pure returns (uint256) {
        uint256 len = b.length;
        for (uint256 i = start; i < len; i++) {
            bytes1 c = b[i];
            if (c == CR) {
                if (i + 1 < len && b[i + 1] == LF) return i;
                revert MalformedHeader();
            }
            if (c == LF) revert MalformedHeader();
        }
        return len;
    }

    function _hasPrefix(bytes memory b, uint256 s, uint256 e, bytes memory prefix) private pure returns (bool) {
        if (e - s < prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (b[s + i] != prefix[i]) return false;
        }
        return true;
    }

    function _indexOf(bytes memory b, bytes1 c, uint256 from, uint256 to) private pure returns (uint256) {
        for (uint256 i = from; i < to; i++) {
            if (b[i] == c) return i;
        }
        return to;
    }

    function _trim(bytes memory b, uint256 s, uint256 e) private pure returns (uint256, uint256) {
        while (s < e && b[s] == SP) s++;
        while (e > s && b[e - 1] == SP) e--;
        return (s, e);
    }

    function _slice(bytes memory b, uint256 s, uint256 e) private pure returns (bytes memory out) {
        out = new bytes(e - s);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[s + i];
        }
    }

    function _lower(bytes memory x) internal pure returns (bytes memory) {
        for (uint256 i = 0; i < x.length; i++) {
            bytes1 c = x[i];
            if (c >= 0x41 && c <= 0x5a) x[i] = bytes1(uint8(c) + 32);
        }
        return x;
    }

    function _eq(bytes memory b, uint256 s, uint256 e, bytes memory lit) private pure returns (bool) {
        if (e - s != lit.length) return false;
        for (uint256 i = 0; i < lit.length; i++) {
            if (b[s + i] != lit[i]) return false;
        }
        return true;
    }

    function _eqLower(bytes memory b, uint256 s, uint256 e, bytes memory lit) private pure returns (bool) {
        if (e - s != lit.length) return false;
        for (uint256 i = 0; i < lit.length; i++) {
            bytes1 c = b[s + i];
            if (c >= 0x41 && c <= 0x5a) c = bytes1(uint8(c) + 32);
            if (c != lit[i]) return false;
        }
        return true;
    }

    function _parseUint64(bytes memory b, uint256 s, uint256 e) private pure returns (uint64) {
        if (s == e || e - s > 19) revert MalformedHeader();
        uint256 v;
        for (uint256 i = s; i < e; i++) {
            uint8 c = uint8(b[i]);
            if (c < 0x30 || c > 0x39) revert MalformedHeader();
            v = v * 10 + (c - 0x30);
        }
        if (v > type(uint64).max) revert MalformedHeader();
        return uint64(v);
    }
}
