# Setting up the research agent — step 1, from zero

This guide assumes a Mac and no developer setup. By the end you will have the
research cockpit running on your own machine, and you will know what it does
when you press the one button.

Everything runs in Docker, so nothing gets installed on your Mac except Docker
itself, and `docker compose down` stops it all. Your runs survive that; the
next section says how.

## 1. Install Docker Desktop

1. Download Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/
   — pick **Apple Silicon** for an M1/M2/M3/M4 Mac, **Intel** for older ones.
   (Apple menu → About This Mac tells you which you have.)
2. Open the downloaded `.dmg` and drag Docker into Applications.
3. Launch Docker from Applications. It will ask for your Mac password to
   finish installing — that's normal. Wait until the whale icon in the menu
   bar stops animating and says "Docker Desktop is running".

Verify it works. Open **Terminal** (Applications → Utilities → Terminal) and
type:

```bash
docker --version
docker compose version
```

Both should print a version number. If they do, Docker is ready.

## 2. Get the code

If someone gave you this folder, you already have it — `cd` into it in
Terminal and skip to step 3. Otherwise:

```bash
git clone <repo-url> agent-collection
cd agent-collection/marketing-research-agent
```

From here on, every command runs in the `marketing-research-agent` folder.

## 3. Fill in the keys

```bash
cp .env.example .env
```

Now open `.env` in any text editor and fill in five values. Three are secrets
you generate yourself in Terminal — each command prints one line; paste the
output in:

```bash
openssl rand -hex 24    # -> HERMES_API_KEY
openssl rand -hex 32    # -> MRA_JWT_SECRET
openssl rand -hex 32    # -> SEARXNG_SECRET
```

The other two are API keys you sign up for:

| Key | Where from | What it pays for |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys | the AI itself. A run is a lot of tokens — one real stage-1 run cost ~1M tokens, so put a few dollars of credit on the account |
| `FIRECRAWL_API_KEY` | https://www.firecrawl.dev/app/api-keys | reading web pages. The free tier is enough to start |

Leave everything else as-is. `MRA_COOKIE_SECURE=false` is already set, and it
must stay false for `http://localhost` — flip it and login silently stops
working.

## 4. Start it

```bash
docker compose up -d --build
```

The first time, this downloads about 3 GB of images and takes a few minutes.
Later starts take seconds.

Check it came up clean:

```bash
docker compose ps
```

You want `mra`, `mra-hermes`, `mra-searxng` all **Up**, and `mra-hermes-config`
**Exited (0)**. That last one is a one-shot setup job, not a crash — it ran,
set one config value, and finished, and "Exited (0)" is what success looks
like for it.

Then open the cockpit:

```bash
open http://localhost:8080
```

## 5. Run it

Press **Start run**. Two boxes:

- **Product** — name a product or a category. "mullein" works; so does
  "MagnaCalm glycinate 400mg".
- **Market** — a country or "global".

Click Start run and walk away. A real run takes anywhere from a few minutes
to half an hour — the mullein run took 8 minutes and read 15 pages. You can
close the browser; the run keeps going, and it will be there when you come
back.

## What the agent actually does in step 1

Step 1 is "raw material": it gathers evidence from the open web and, by
design, draws **no conclusions**. The output format literally has no field a
conclusion could be written into — no "summary", no "finding". What comes back
is a structured JSON packet with these parts:

- **brief** — what was researched, as the agent understood it: your product
  and market, plus whichever product URL it settled on if you didn't give one.
- **sources** — every page it touched, whether or not it was used. Rejected
  pages stay in the list on purpose: they are the audit trail of what was
  searched and filtered out, and each one carries a note saying why it was
  kept or dropped.
- **excerpts** — customer quotes copied character for character. Never
  paraphrased: "I wake up at 3am and can't get back to sleep" is kept as-is,
  not cleaned up to "sleep maintenance issues".
- **measurements** — numbers a source states, with unit and period: market
  size, ratings, search volume. The agent's own reading of a number is not
  allowed here.
- **attributes** — fields read off pages: dose, price, format, when an ad was
  first seen.
- **saturation** — how the agent decided it had gathered enough, as a count of
  new themes per source. "I stopped looking" has to be a number, not a claim.
- **nodes** — the four research areas (the product itself, competitors,
  customer reviews, category/market data), each marked complete or incomplete
  with the reason.
- **gaps** — what it could not find. This list must not be empty: a run
  reporting zero gaps is treated as failed, because real research always has
  holes and an agent that can't say "I couldn't find this" will invent it.

In the cockpit, the counts up top (sources, excerpts, measurements, gaps) are
a summary of this packet, and the reasoning trace in the middle is the agent's
live work: each search, each page read, each note.

## When a run ends INVALID or FAILED

Three statuses, and the difference matters:

- **completed** — the packet passed validation. Read it.
- **invalid** — the agent finished, but its output broke the format rules
  (wrong field type, an invented category). The work exists — you can read the
  raw output — but nothing enters the structured view, because an untrusted
  packet must not look like real research. This is the system working, not
  crashing.
- **failed** — the run itself died: the harness was unreachable, the API key
  was wrong, the stream dropped. Check `docker compose ps` and
  `docker compose logs mra`.

## Stop it

```bash
docker compose down
```

Your runs, the agent's memory, and every archived page live in Docker volumes
and survive this. `docker compose down -v` deletes those too — rarely what
you want.

## If something goes wrong during setup

| Symptom | What to check |
|---|---|
| `docker: command not found` | Docker Desktop isn't running — launch it and wait for the whale icon to settle |
| First `up` is very slow | Normal. It's a multi-GB download; later starts are seconds |
| `mra-hermes-config` shows `Exited (0)` | Not a fault — it's a one-shot setup job that finished |
| Run fails instantly with a 401 / "invalid API key" | The `.env` key and the harness disagree. See `../setup.md` §5a for the one-command fix |
| Login appears to work then logs you out | `MRA_COOKIE_SECURE` is set to `true`; it must be `false` for localhost |
