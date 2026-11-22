import argparse

import uvicorn


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Launch the IPL auction simulator.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run("src.web_app:app", host="127.0.0.1", port=args.port)
