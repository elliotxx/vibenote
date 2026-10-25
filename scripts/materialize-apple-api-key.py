#!/usr/bin/env python3
"""Write an App Store Connect API key from APPLE_API_KEY_P8 without printing it."""

import base64
import os
import pathlib
import stat
import sys

HEADER = "-----BEGIN " + "PRIVATE KEY" + "-----"
FOOTER = "-----END " + "PRIVATE KEY" + "-----"


def pem_text(raw: str) -> str:
    if HEADER in raw and FOOTER in raw:
        return raw if raw.endswith("\n") else raw + "\n"
    try:
        decoded = base64.b64decode(raw.strip(), validate=True).decode("utf-8")
    except Exception as error:
        raise SystemExit("APPLE_API_KEY_P8 is neither a PEM key nor base64.") from error
    if HEADER not in decoded or FOOTER not in decoded:
        raise SystemExit("APPLE_API_KEY_P8 does not contain an App Store Connect API key.")
    return decoded if decoded.endswith("\n") else decoded + "\n"


def main() -> None:
    raw = os.environ.get("APPLE_API_KEY_P8", "")
    if not raw.strip():
        print("APPLE_API_KEY_P8 is empty; notarization will use APPLE_API_KEY when that path is already set.")
        return
    text = pem_text(raw)
    temp_root = os.environ.get("RUNNER_TEMP") or os.environ.get("TMPDIR") or "/tmp"
    destination = pathlib.Path(temp_root) / "AuthKey.p8"
    destination.write_text(text, encoding="utf-8")
    destination.chmod(stat.S_IRUSR | stat.S_IWUSR)
    github_env = os.environ.get("GITHUB_ENV")
    line = f"APPLE_API_KEY={destination}\n"
    if github_env:
        with open(github_env, "a", encoding="utf-8") as handle:
            handle.write(line)
        print("Prepared App Store Connect API key for notarization.")
        return
    sys.stdout.write(str(destination))


if __name__ == "__main__":
    main()
