/**
 * Single-user password auth with a signed session cookie.
 *
 * scrypt from node's own crypto rather than bcrypt/argon2: one less dependency,
 * no native build in the image, and it is the right primitive for this. The JWT
 * comes from `hono/jwt`, which is already here.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { Jwt } from "hono/utils/jwt";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 14, r: 8, p: 1 };
const KEYLEN = 32;

/**
 * ":" rather than "$" as the field separator: this value lives in a .env file
 * read by docker compose, which would interpolate "$..." as a variable and
 * silently mangle the hash.
 */
const SEPARATOR = ":";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await scryptAsync(password, salt, KEYLEN, SCRYPT);
  return ["scrypt", salt.toString("base64"), digest.toString("base64")].join(SEPARATOR);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(SEPARATOR);
  if (parts.length !== 3) return false;
  const [scheme, saltB64, digestB64] = parts as [string, string, string];
  if (scheme !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(digestB64, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, SCRYPT);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Issues and validates the session JWT carried in an httpOnly cookie. */
export class TokenService {
  private readonly secret: string;
  private readonly sessionHours: number;

  constructor(secret: string, options: { sessionHours: number }) {
    if (!secret) throw new Error("MRA_JWT_SECRET must be set");
    this.secret = secret;
    this.sessionHours = options.sessionHours;
  }

  async issue(subject: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return await Jwt.sign(
      { sub: subject, iat: now, exp: now + this.sessionHours * 3600 },
      this.secret,
      "HS256",
    );
  }

  async verify(token: string): Promise<string | null> {
    try {
      const payload = await Jwt.verify(token, this.secret, "HS256");
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
