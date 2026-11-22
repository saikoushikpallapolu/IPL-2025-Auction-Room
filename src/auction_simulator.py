import sys
import time

if sys.platform == "win32":
    import msvcrt
else:
    import select
    import termios
    import tty

from .simulator_engine import Auction, Catalog, TEAMS


def get_non_blocking_input(timeout_secs=30):
    """Cross-platform non-blocking key scanner with a real-time terminal countdown."""
    if not sys.stdin.isatty():
        return input("B: bid/match, K: skip, S: standings, Enter: wait ").strip().lower()
    start = time.monotonic()
    sys.stdout.flush()

    if sys.platform == "win32":
        # Windows Keyboard Polling Logic Loop
        last_printed = -1
        while time.monotonic() - start < timeout_secs:
            rem = int(timeout_secs - (time.monotonic() - start))
            if rem != last_printed:
                sys.stdout.write(f"\r{rem}s to next call | B: bid/match, K: skip, S: standings ")
                sys.stdout.flush()
                last_printed = rem
            if msvcrt.kbhit():
                ch = msvcrt.getch().decode('utf-8', errors='ignore').lower()
                if ch in {'b', 'k', 's'}:
                    print()
                    return ch
            time.sleep(0.1)
        print()
        return ''
    else:
        # POSIX Unix Keyboard Polling Logic Loop
        old_settings = termios.tcgetattr(sys.stdin)
        try:
            tty.setcbreak(sys.stdin.fileno())
            last_printed = -1
            while time.monotonic() - start < timeout_secs:
                rem = int(timeout_secs - (time.monotonic() - start))
                if rem != last_printed:
                    sys.stdout.write(f"\r{rem}s to next call | B: bid/match, K: skip, S: standings ")
                    sys.stdout.flush()
                    last_printed = rem
                r, _, _ = select.select([sys.stdin], [], [], 0.1)
                if r:
                    ch = sys.stdin.read(1).lower()
                    if ch in {'b', 'k', 's'}:
                        print()
                        return ch
        finally:
            termios.tcsetattr(sys.stdin, old_settings)
        print()
        return ''


def main():
    catalog = Catalog.load()
    print("IPL 2025 Auction Room")
    for code, (name, *_) in TEAMS.items():
        print(f"  {code}: {name}")
    team = input("Franchise code: ").strip().upper()
    while team not in TEAMS:
        team = input("Enter a listed franchise code: ").strip().upper()

    keep = []
    for player in catalog.retained[team]:
        if input(f"Retain {player['name']} for {player['price'] / 100:g} Cr? [Y/n] ").strip().lower() != "n":
            keep.append(player["name"])

    auction = Auction(catalog, team, keep)
    last_lot = 0
    last_call = None
    while (state := auction.snapshot())["phase"] != "complete":
        player = state["player"]
        if state["phase"] == "nomination":
            print("\nNominate players for the accelerated round:")
            for nominee in state["nominees"]:
                print(f"  {nominee['id']}: {nominee['name']}")
            try:
                auction.act("nominate", nominations=input("Enter up to 10 IDs separated by spaces: ").split())
            except ValueError as error:
                print(error)
            continue
        if state["phase"] == "reveal":
            group = state["set"]
            print(f"\n{group['code']} · {group['category']} ({len(group['players'])} players)")
            print(", ".join(p["name"] for p in group["players"]))
            input("Press Enter to open bidding.")
            auction.act("open")
            continue
        if state["lot"] != last_lot:
            print(f"\nLot {state['lot']} of {state['total']}: {player['name']} ({player['role']}, {player['country']})")
            print(f"Reserve: {player['reserve'] / 100:g} Cr")
            last_lot = state["lot"]
        if state["phase"] == "result":
            result = state["results"][-1]
            if result["team"]:
                print(f"Sold to {result['team']} for {result['price'] / 100:g} Cr")
            else:
                print("Unsold")
            input("Press Enter for the next player.")
            auction.act("next")
            continue

        matching = state["phase"] == "rtm"
        call = (state["lot"], state["leader"], state["price"], state["cue"])
        if call != last_call:
            if state["cue"] in {"once", "twice"}:
                print(f"Going {state['cue']}…")
            elif state["leader"]:
                print(f"{state['leader']} bid {state['price'] / 100:g} Cr")
            last_call = call
        can_bid = matching or state["can_bid"]
        if can_bid:
            price = state["price"] if matching else state["next_price"]
            print(f"{'Match' if matching else 'Next bid'}: {price / 100:g} Cr")
        else:
            print("Your purse or squad limits prevent a bid.")
        key = get_non_blocking_input(state["seconds"])
        if key == "s":
            for code, franchise in state["teams"].items():
                print(f"  {code}: {franchise['purse'] / 100:g} Cr, {len(franchise['roster'])}/25 players")
        elif key == "b" and can_bid:
            if state["rtm_stage"] == "final":
                try:
                    amount = input("Final bid in crore, or Enter to keep the current bid: ").strip()
                    auction.act("raise", amount=round(float(amount) * 100)) if amount else auction.act("pass")
                except (ValueError, OverflowError) as error:
                    print(error)
            else:
                auction.act("match" if matching else "bid")
        elif key == "k":
            auction.act("skip")
        elif not sys.stdin.isatty():
            time.sleep(state["seconds"])

    print("Auction complete.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nAuction closed.")
