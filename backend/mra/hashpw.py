"""Produce a password hash for MRA_APP_PASSWORD_HASH.

    python -m mra.hashpw

The separator is ":" rather than "$" because this value lands in a .env file
read by docker compose, which interpolates "$..." and would silently mangle it.
"""

from __future__ import annotations

import getpass

from .auth import hash_password


def main() -> None:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Again: "):
        raise SystemExit("passwords do not match")
    print(hash_password(password))


if __name__ == "__main__":
    main()
