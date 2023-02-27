import os

import uvicorn
import logging

log_level = os.getenv("LOG_LEVEL", "error").upper()
logging.basicConfig(level=logging.getLevelName(log_level))

if __name__ == "__main__":
    uvicorn.run("main:app",
                host=os.getenv('HOST', '0.0.0.0'),
                port=int(os.getenv('APP_PORT', '4180')),
                )
