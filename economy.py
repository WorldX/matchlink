GIFTS = [
    {'id': 'spark', 'name': 'Spark', 'emoji': '✨', 'minMinutes': 1, 'tokens': 10},
    {'id': 'heart', 'name': 'Heart', 'emoji': '❤️', 'minMinutes': 3, 'tokens': 25},
    {'id': 'star', 'name': 'Star', 'emoji': '⭐', 'minMinutes': 5, 'tokens': 50},
    {'id': 'crown', 'name': 'Crown', 'emoji': '👑', 'minMinutes': 10, 'tokens': 100},
    {'id': 'gem', 'name': 'Gem', 'emoji': '💎', 'minMinutes': 15, 'tokens': 175},
    {'id': 'flame', 'name': 'Flame', 'emoji': '🔥', 'minMinutes': 20, 'tokens': 250},
    {'id': 'trophy', 'name': 'Trophy', 'emoji': '🏆', 'minMinutes': 30, 'tokens': 400},
    {'id': 'cosmic', 'name': 'Cosmic Orb', 'emoji': '🌌', 'minMinutes': 45, 'tokens': 600},
]

STARTING_TOKENS = 100
TOKENS_PER_MINUTE = 5
EARLY_EXIT_SECONDS = 60
DECLINE_PENALTY = 8
EARLY_HANGUP_PENALTY = 20
MID_CHAT_EXIT_PENALTY = 12
MIN_CHAT_FOR_REWARD_SECONDS = 30


def gifts_for_minutes(minutes):
    return [g for g in GIFTS if minutes >= g['minMinutes']]


def minute_tokens(minutes):
    return max(0, int(minutes * TOKENS_PER_MINUTE))


def settle_chat(duration_seconds, exit_type='normal'):
    """
    exit_type: normal | decline | early_hangup | mid_exit | partner_left
    Returns dict with tokensDelta, giftsEarned, penalty, breakdown.
    """
    minutes = duration_seconds / 60
    earned = minute_tokens(minutes)
    gifts = []
    penalty = 0
    breakdown = []

    if duration_seconds >= MIN_CHAT_FOR_REWARD_SECONDS:
        earned += sum(g['tokens'] for g in gifts_for_minutes(minutes))
        gifts = gifts_for_minutes(minutes)
        breakdown.append(f'+{minute_tokens(minutes)} chat time')
        for g in gifts:
            breakdown.append(f"+{g['tokens']} {g['name']} {g['emoji']}")
    else:
        earned = 0
        breakdown.append('Chat too short for rewards')

    if exit_type == 'decline':
        penalty = DECLINE_PENALTY
        breakdown.append(f'-{penalty} declined match')
    elif exit_type == 'early_hangup':
        penalty = EARLY_HANGUP_PENALTY
        breakdown.append(f'-{penalty} left too early')
    elif exit_type == 'mid_exit' and duration_seconds >= EARLY_EXIT_SECONDS:
        penalty = MID_CHAT_EXIT_PENALTY
        breakdown.append(f'-{penalty} left mid-chat')
    elif exit_type == 'partner_left':
        penalty = 0
        breakdown.append('Partner left — no penalty')

    net = earned - penalty
    return {
        'tokensDelta': net,
        'tokensEarned': earned,
        'penalty': penalty,
        'giftsEarned': [{'id': g['id'], 'name': g['name'], 'emoji': g['emoji']} for g in gifts],
        'durationSeconds': duration_seconds,
        'breakdown': breakdown,
    }
