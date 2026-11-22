"""Playing-XI fit for a ten-franchise auction with a four-overseas XI limit."""
from math import log1p

XI_TARGETS = {"keeper": 1, "top_order": 3, "finisher": 2, "pace": 2, "spin": 1, "death": 2}


def primary_skill(player):
    form = player.get("form") or {}
    role = player["role"]
    style = player.get("bowling_style", "").lower()
    if role == "WK":
        return "keeper"
    if role in {"BOWL", "AR"} and form.get("death_bowl_balls", 0) >= 24:
        if form["death_bowl_balls"] >= 0.28 * sum(form.get(f"{p}_bowl_balls", 0) for p in ("powerplay", "middle", "death")):
            return "death"
    if role == "BOWL" or (role == "AR" and form.get("middle_bowl_balls", 0) >= 36 and form.get("middle_bowl_balls", 0) > 1.5 * sum(form.get(f"{phase}_bat_balls", 0) for phase in ("powerplay", "middle", "death"))):
        return "spin" if any(word in style for word in ("spin", "break", "orthodox")) or player.get("set_code", "").startswith(("SP", "USP")) else "pace"
    if role == "AR" and form.get("powerplay_bat_balls", 0) >= 35 and form.get("powerplay_bat_balls", 0) > form.get("death_bat_balls", 0):
        return "top_order"
    if role == "AR" or (form.get("death_bat_balls", 0) >= 20 and form.get("death_runs", 0) >= 1.4 * form["death_bat_balls"]):
        return "finisher"
    return "top_order"


def playing_quality(player):
    """Shrink phase rates toward neutral when the delivery sample is small."""
    form = player.get("form") or {}
    skill = player["skill"]
    if skill in {"keeper", "top_order", "finisher"}:
        phases = ("death",) if skill == "finisher" else ("powerplay", "middle")
        balls = sum(form.get(f"{phase}_bat_balls", 0) for phase in phases)
        runs = sum(form.get(f"{phase}_runs", 0) for phase in phases)
        prior = 1.55 if skill == "finisher" else 1.35
        rate = (runs + 60 * prior) / (balls + 60)
        return round(max(0.65, min(1.4, rate / prior)), 4)
    phases = {"death": ("death",), "spin": ("middle",), "pace": ("powerplay", "middle")}[skill]
    balls = sum(form.get(f"{phase}_bowl_balls", 0) for phase in phases)
    runs = sum(form.get(f"{phase}_conceded", 0) for phase in phases)
    wickets = sum(form.get(f"{phase}_wickets", 0) for phase in phases)
    economy = {"death": 9.6, "spin": 7.8, "pace": 8.1}[skill]
    conceded = (runs + 60 * economy / 6) * 6 / (balls + 60)
    wicket_rate = (wickets + 2.5) / (balls + 60)
    return round(max(0.65, min(1.4, 0.65 * economy / conceded + 0.35 * 24 * wicket_rate)), 4)


def xi_fit(player, roster, alternatives):
    """Return a willingness multiplier based on XI need and available replacements."""
    skill = player.get("skill") or primary_skill(player)
    slots = XI_TARGETS[skill]
    incumbents = [member for member in roster if member.get("skill") == skill]
    quality = player.get("quality", 1.0)
    values = sorted((member.get("quality", 1.0) for member in incumbents), reverse=True)
    vacancy = max(0, slots - len(values)) / slots
    upgrade = 0 if vacancy else max(0, min(1, 2 * (quality / values[slots - 1] - 1)))
    alternatives_in_tier = alternatives[(skill, player["overseas"])]
    scarcity = 1 / (1 + alternatives_in_tier / 8)
    overseas = sum(member["overseas"] for member in roster)
    congestion = 0.14 * min(2, max(0, overseas - 3)) if player["overseas"] else 0
    return max(0.48, 0.70 + 0.44 * vacancy + 0.27 * upgrade + 0.13 * scarcity - congestion)


def projected_xi(roster):
    """Maximize specialist coverage, then form, under the shared overseas cap."""
    def quality(player):
        return player.get("quality", 1.0) + 0.001 * log1p(player.get("market_value") or player["price"])

    states = {0: (0.0, [])}
    for skill, slots in XI_TARGETS.items():
        candidates = [p for p in roster if p["skill"] == skill]
        domestic = sorted((p for p in candidates if not p["overseas"]), key=quality, reverse=True)
        foreign = sorted((p for p in candidates if p["overseas"]), key=quality, reverse=True)
        updated = {}
        for used, (score, selected) in states.items():
            for count in range(min(slots, len(foreign), 4 - used) + 1):
                players = foreign[:count] + domestic[:slots - count]
                new_score = score + sum(map(quality, players))
                new_selection = selected + players
                previous = updated.get(used + count)
                if previous is None or (len(new_selection), new_score) > (len(previous[1]), previous[0]):
                    updated[used + count] = new_score, new_selection
        states = updated
    _, selections = max(states.values(), key=lambda item: (len(item[1]), item[0]))
    remaining = XI_TARGETS.copy()
    starters = []
    roster_indexes = {id(player): index for index, player in enumerate(roster)}
    for player in selections:
        skill = player["skill"]
        starters.append({
            "name": player["name"], "skill": skill, "overseas": player["overseas"],
            "roster_index": roster_indexes[id(player)],
        })
        remaining[skill] -= 1
    return {"players": starters, "vacancies": {skill: count for skill, count in remaining.items() if count}}
