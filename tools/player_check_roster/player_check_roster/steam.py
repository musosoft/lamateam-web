"""Lossless public individual Steam IDs, matching web checkSteamId."""

import re

BASE = 76561197960265728


def canonical(identity):
    """Return (Steam64, normalized STEAM_0:Y:Z); never echo input on error."""
    if not isinstance(identity, str) or len(identity) > 32:
        raise ValueError("Invalid Steam identity")
    two = re.fullmatch(r"STEAM_[01]:([01]):([0-9]{1,10})", identity)
    three = re.fullmatch(r"\[U:1:([0-9]{1,10})\]", identity)
    if re.fullmatch(r"[0-9]{17}", identity):
        account = int(identity) - BASE
    elif two:
        account = 2 * int(two[2]) + int(two[1])
    elif three:
        account = int(three[1])
    else:
        raise ValueError("Invalid Steam identity")
    if not 1 <= account <= 4294967295:
        raise ValueError("Invalid Steam account range")
    return str(BASE + account), f"STEAM_0:{account % 2}:{account // 2}"


def steamid64_to_2(identity):
    if not isinstance(identity, str) or not re.fullmatch(r"[0-9]{17}", identity):
        raise ValueError("Invalid Steam64")
    return canonical(identity)[1]


def steamid2_to_64(identity):
    if not isinstance(identity, str) or not re.fullmatch(r"STEAM_[01]:[01]:[0-9]{1,10}", identity):
        raise ValueError("Invalid Steam2")
    return canonical(identity)[0]
