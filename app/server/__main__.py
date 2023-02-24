import uvicorn
import os

if __name__ == "__main__":
    uvicorn.run("main:app",
                host=os.getenv('HOST', '0.0.0.0'),
                port=int(os.getenv('APP_PORT', '4180')),
                log_level=os.getenv("LOG_LEVEL", "info"),
                )
