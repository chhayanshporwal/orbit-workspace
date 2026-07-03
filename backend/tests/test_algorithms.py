from datetime import datetime, timedelta, timezone
from services.algorithms import calculate_urgency_score, workload_balancer


# ==========================================
# ALGORITHM 1: SMART URGENCY TESTS
# ==========================================
def test_urgency_score_past_due():
    now = datetime.now(timezone.utc)
    # A High priority task that is past due should max out at 100
    score = calculate_urgency_score("High", now - timedelta(hours=2))
    assert score == 100.0


def test_urgency_score_future_base():
    now = datetime.now(timezone.utc)
    # A Low priority task due in 10 days should just return its base score (10.0)
    score = calculate_urgency_score("Low", now + timedelta(days=10))
    assert score == 10.0


def test_urgency_score_escalation():
    now = datetime.now(timezone.utc)
    # A Medium task due in 12 hours should score higher than a Medium task due in 4 days
    urgent_score = calculate_urgency_score("Medium", now + timedelta(hours=12))
    relaxed_score = calculate_urgency_score("Medium", now + timedelta(days=4))
    assert urgent_score > relaxed_score


# ==========================================
# ALGORITHM 2: WORKLOAD BALANCER TESTS
# ==========================================
def test_workload_balancer_selects_free_user():
    now = datetime.now(timezone.utc)
    workloads = [
        # User 1 has a highly urgent task
        {
            "user_id": 1,
            "tasks": [{"priority": "High", "due_date": now + timedelta(hours=5)}],
        },
        # User 2 has absolutely no tasks
        {"user_id": 2, "tasks": []},
    ]

    best_user = workload_balancer(workloads)

    # The balancer MUST select User 2 because they have 0 workload
    assert best_user == 2


def test_workload_balancer_tie_breaker():
    now = datetime.now(timezone.utc)
    future_date = now + timedelta(days=10)
    workloads = [
        # User 1 has TWO low priority tasks
        {
            "user_id": 1,
            "tasks": [
                {"priority": "Low", "due_date": future_date},
                {"priority": "Low", "due_date": future_date},
            ],
        },
        # User 2 has ONE low priority task
        {"user_id": 2, "tasks": [{"priority": "Low", "due_date": future_date}]},
    ]

    best_user = workload_balancer(workloads)

    # Both users have low urgency, but User 2 has fewer total tasks, so they should win
    assert best_user == 2


def test_workload_balancer_empty_state():
    # If there are no users in the workspace, it should safely return None
    assert workload_balancer([]) is None
