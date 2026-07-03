import os
import redis
from slowapi import Limiter
from slowapi.util import get_remote_address

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Redis configuration
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# Limiter configuration
limiter = Limiter(key_func=get_remote_address, storage_uri=REDIS_URL)
