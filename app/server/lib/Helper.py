import asyncio
import hashlib
from concurrent.futures import ThreadPoolExecutor
from functools import partial, wraps


def sync_to_async(func, *args, **kwargs):
    lock = asyncio.Lock()

    @wraps(func)
    async def inner():
        async with lock:
            loop = asyncio.get_running_loop()
            p_func = partial(func, *args, **kwargs)
            with ThreadPoolExecutor(max_workers=1) as executor:
                return await loop.run_in_executor(executor, p_func)

    return inner

def get_sha256_hash(file_path: str) -> str:
    with open(file_path, 'rb') as f:
        sha256 = hashlib.sha256()
        while True:
            chunk = f.read(4096)
            if not chunk:
                break
            sha256.update(chunk)
        return sha256.hexdigest()