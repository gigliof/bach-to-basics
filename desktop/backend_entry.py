"""Frozen desktop backend. Bind an OS-assigned loopback port; watch parent exit."""
import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()
    import json
    import os
    import signal
    import socket
    import threading
    import time
    import uvicorn
    from main import app

    parent = os.getppid()

    def watch_parent():
        while True:
            time.sleep(2)
            if os.getppid() != parent:
                os.killpg(os.getpgrp(), signal.SIGTERM)
                return

    threading.Thread(target=watch_parent, daemon=True).start()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", log_level="warning", loop="asyncio", http="h11",
    ))
    server.run(sockets=[sock])
