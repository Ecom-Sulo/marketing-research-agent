"""Single-user password auth with a signed session cookie.

scrypt from the standard library rather than bcrypt/passlib: one less
dependency, and it is the right primitive for this.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

_SCRYPT = {"n": 2**14, "r": 8, "p": 1}
_KEYLEN = 32


# ":" rather than "$" as the field separator: this value lives in a .env file
# read by docker compose, which would interpolate "$..." as a variable and
# silently mangle the hash.
_SEPARATOR = ":"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=_KEYLEN, **_SCRYPT)
    return _SEPARATOR.join(
        ["scrypt", base64.b64encode(salt).decode(), base64.b64encode(digest).decode()]
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt_b64, digest_b64 = encoded.split(_SEPARATOR)
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(digest_b64)
    actual = hashlib.scrypt(password.encode(), salt=salt, dklen=len(expected), **_SCRYPT)
    return hmac.compare_digest(actual, expected)


class TokenService:
    """Issues and validates the session JWT carried in an httpOnly cookie."""

    algorithm = "HS256"

    def __init__(self, secret: str, *, session_hours: int) -> None:
        if not secret:
            raise ValueError("JWT_SECRET must be set")
        self._secret = secret
        self._session_hours = session_hours

    def issue(self, subject: str) -> str:
        now = datetime.now(timezone.utc)
        return jwt.encode(
            {"sub": subject, "iat": now, "exp": now + timedelta(hours=self._session_hours)},
            self._secret,
            algorithm=self.algorithm,
        )

    def verify(self, token: str) -> str | None:
        try:
            payload = jwt.decode(token, self._secret, algorithms=[self.algorithm])
        except jwt.PyJWTError:
            return None
        return payload.get("sub")
