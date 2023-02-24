import asyncio
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
