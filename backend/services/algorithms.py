from datetime import datetime, timezone


def calculate_urgency_score(priority_level: str | int, due_date: datetime) -> float:
    """
    Algorithm 1: Smart Urgency Scoring
    Calculates a dynamic urgency score (0-100) based on priority and time remaining.
    Does not rely on external libraries.
    """
    if isinstance(priority_level, int):
        if priority_level >= 4:
            priority_level = "High"
        elif priority_level == 3:
            priority_level = "Medium"
        else:
            priority_level = "Low"

    # Base scores set the foundation
    base_scores = {"High": 70.0, "Medium": 40.0, "Low": 10.0}
    base = base_scores.get(priority_level, 10.0)

    if not due_date:
        return base

    now = datetime.now(timezone.utc)
    time_left = due_date - now
    hours_left = time_left.total_seconds() / 3600

    # If the deadline has passed, max out the urgency
    if hours_left <= 0:
        return min(base + 50.0, 100.0)

    # Time Multiplier: The closer the deadline, the higher the score penalty
    if hours_left < 24:
        # Adds up to 36 points if less than 24 hours
        urgency_bump = (24 - hours_left) * 1.5
        return min(base + urgency_bump, 100.0)
    elif hours_left < 72:
        # Adds up to 14 points if less than 3 days
        urgency_bump = (72 - hours_left) * 0.2
        return min(base + urgency_bump, 100.0)

    return base


def workload_balancer(users_workloads: list[dict]) -> int | None:
    """
    Algorithm 2: The Workload Balancer
    Evaluates the total urgency weight of all active tasks for each user.
    Returns the user_id with the lowest cumulative workload score.

    Expected input format:
    [
        {"user_id": 1, "tasks": [{"priority": "High", "due_date": <datetime>}, ...]},
        {"user_id": 2, "tasks": []}
    ]
    """
    if not users_workloads:
        return None

    best_user_id = None
    lowest_workload_score = float("inf")

    for user_data in users_workloads:
        user_id = user_data["user_id"]
        tasks = user_data["tasks"]

        # Calculate total workload weight for this specific user
        total_score = 0.0
        for task in tasks:
            total_score += calculate_urgency_score(task["priority"], task["due_date"])

        # Tie-breaker logic: Add a tiny fractional weight based on pure task count
        # so if two users have a score of 0.0, the one with fewer actual tasks wins.
        total_score += len(tasks) * 0.1

        # Determine if this user is the most free
        if total_score < lowest_workload_score:
            lowest_workload_score = total_score
            best_user_id = user_id

    return best_user_id
