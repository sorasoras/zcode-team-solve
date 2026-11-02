import sys


def main():
    data = sys.stdin.buffer.read().decode()
    s = data.strip()
    n = len(s)
    if n == 0:
        print(0)
        return

    # Prefix state after i chars: (d1, d2) = (A_i - B_i, A_i - C_i).
    # A substring s[l:r] is balanced iff p(l) == p(r), so the answer is
    # sum over states of C(count(state), 2).
    # Pack (d1, d2) into one int: d in [-n, n] -> d + n + 1 in [1, 2n+1],
    # base = 2n + 3 keeps the two digits disjoint (injective).
    base = 2 * n + 3
    off = n + 1
    start = off * base + off

    seen = {start: 1}
    d1 = 0
    d2 = 0
    ans = 0

    for ch in s:
        if ch == 'a':
            d1 += 1
            d2 += 1
        elif ch == 'b':
            d1 -= 1
        else:
            d2 -= 1
        key = (d1 + off) * base + (d2 + off)
        c = seen.get(key, 0)
        ans += c
        seen[key] = c + 1

    print(ans)


if __name__ == "__main__":
    main()
