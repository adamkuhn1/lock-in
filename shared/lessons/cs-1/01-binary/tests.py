def test_small_numbers():
    """to_binary handles small numbers"""
    check("to_binary(13, 4)", to_binary(13, 4), [1, 1, 0, 1])
    check("to_binary(1, 1)", to_binary(1, 1), [1])
    check("to_binary(6, 3)", to_binary(6, 3), [1, 1, 0])


def test_padding():
    """to_binary pads with zeros on the left"""
    check("to_binary(13, 8)", to_binary(13, 8), [0, 0, 0, 0, 1, 1, 0, 1])
    check("to_binary(0, 4)", to_binary(0, 4), [0, 0, 0, 0])


def test_edges():
    """to_binary fills every bit at the top of the range"""
    check("to_binary(255, 8)", to_binary(255, 8), [1] * 8)
    check("to_binary(128, 8)", to_binary(128, 8), [1, 0, 0, 0, 0, 0, 0, 0])


def test_too_big():
    """to_binary raises ValueError when n doesn't fit"""
    raises(ValueError, to_binary, 16, 4)
    raises(ValueError, to_binary, 256, 8)
    raises(ValueError, to_binary, -1, 4)


def test_from_binary():
    """from_binary turns bits back into a number"""
    check("from_binary([1, 1, 0, 1])", from_binary([1, 1, 0, 1]), 13)
    check("from_binary([0, 0, 0, 0, 1, 1, 0, 1])", from_binary([0, 0, 0, 0, 1, 1, 0, 1]), 13)
    check("from_binary([1, 0, 1, 1, 0])", from_binary([1, 0, 1, 1, 0]), 22)
    check("from_binary([0])", from_binary([0]), 0)


def test_round_trip():
    """Every 8-bit number survives a round trip"""
    for n in range(256):
        check(f"from_binary(to_binary({n}, 8))", from_binary(to_binary(n, 8)), n)


def test_no_shortcuts():
    """Builds the bits by hand (no bin, format or int(s, 2))"""
    forbid("bin", "format", "int(s, base)")
