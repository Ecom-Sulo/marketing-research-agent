# Finding the best products to sell, from TrendTrack alone

Goal: **API endpoints → run an algorithm → get the best few products by real market
demand.** Then, for those few: **is the market already saturated or not?**

Everything here was checked against the live API on 2026-09-11/12 with a real key.
Numbers in the examples are real responses, not illustrations.

---

## 0. The one problem you have to design around

**TrendTrack has no product-level performance data.** A product record is:

```json
{ "id": "1994224707", "title": "Grass-Fed Whey Protein Isolate",
  "handle": "whey-protein-isolate", "imageUrl": "...", "productUrl": null,
  "price": 59.99, "currency": "USD", "rank": 1,
  "createdAt": "2015-08-05T21:42:56.000Z", "publishedAt": "2017-12-04T22:15:56.000Z" }
```

Nine fields. `rank` is best-seller position **inside that one shop** — nothing more.
No sales, no revenue, no per-product traffic, no per-product ads.

Every number that measures success — visits, growth, ad counts, revenue — is
attached to a **shop**.

**The trick that makes this work:** a product's signal is the *combined behaviour
of every shop that sells it*. If 40 independent shops sell magnesium glycinate,
and those shops are growing, advertising it, and putting it on their front page,
that is product-level evidence assembled from shop-level data.

The set of shops selling one product is called its **cohort** throughout.

There is also **no product ID**. Product ids are per-shop Shopify ids; the same
thing in two shops shares nothing. A "product" here is **a search string you
choose**, and the cohort is whatever matches it. §7 covers how to make that stable.

---

## 1. Cost model — read this before designing anything

Credits are **not** per call. Measured directly:

| Call | Credits |
|---|---|
| `GET /v1/lookup` | **0** |
| `GET /v1/system/freshness`, `/v1/usage`, `/v1/workspace` | **0** |
| `POST /v1/shops/query`, `GET /v1/shops` | **1 per returned shop** |
| `GET /v1/shops/{id}/similar` | **1 per returned shop** |
| `GET /v1/shops/{id}` (detail) | **1**, flat |
| `GET /v1/shops/{id}/products` | **1**, flat — `limit=100` costs the same as `limit=3` |

Proof:

```bash
# before: 151 credits used
curl -s -X POST "https://api.trendtrack.io/v1/shops/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" -H "Content-Type: application/json" \
  -d '{"search":"creatine","searchType":"productName","limit":10}'
# after: 161   -> +10 for 10 rows

curl -s "https://api.trendtrack.io/v1/shops/35596f7f-cc73-4494-9c67-a0acfec2ebda"
# +1

curl -s "https://api.trendtrack.io/v1/shops/35596f7f-cc73-4494-9c67-a0acfec2ebda/products?limit=10"
# +1  (flat — always ask for limit=100)
```

Three consequences that shape the whole algorithm:

1. **Search is the expensive part.** Sample the cohort, don't buy all of it.
2. **`pagination.total` is free information.** A `limit=1` query costs 1 credit and
   still tells you the full number of sellers. That is your whole F3 for 1 credit.
3. **Always pull `products` with `limit=100`** — same price as 3.

On a 10,000/month plan, a 20-shop cohort costs about **61 credits per product**
(1 + 20 + 20 + 20), so roughly **160 products scored per month**.

---

## 2. The endpoints, with curls

Base URL `https://api.trendtrack.io`; every request needs
`Authorization: Bearer $TRENDTRACK_API_KEY`.

### 2.1 Resolve a domain to a shop id — free

```bash
curl -s "https://api.trendtrack.io/v1/lookup?q=transparentlabs.com" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

Returns the shop id, the linked Facebook advertiser, and quick signals
(`activeAds`, `liveAdsCount`, `reach30d`). Costs nothing — use it freely.

### 2.2 Find the cohort for a product — the core call

```bash
curl -s -X POST "https://api.trendtrack.io/v1/shops/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "search": "magnesium glycinate",
    "searchType": "productName",
    "adsTimePeriod": "last30d",
    "limit": 50
  }'
```

`searchType` options: `productName` (product text), `domain` (exact), `shopContains`
(broad site text).

**Always set `adsTimePeriod: "last30d"`.** The default is `last24h`, and they
genuinely differ — 24 of 50 shops returned different `activeAds`, e.g.
`nutralife.com.au` reads **0 ads** at `last24h` and **25** at `last30d`. The
default makes live advertisers look dormant.

Each row (a `ShopSummary`) already contains, for free:

| Field | Notes |
|---|---|
| `traffic.monthlyVisits` | demand level |
| `traffic.growth30d` | fraction — `0.18` = +18% |
| `traffic.history[6]` | **monthly** points, 6 of them |
| `advertising.activeAds` | follows `adsTimePeriod` |
| `advertising.history[26]` | **weekly** points, 6 months — the only weekly series in the API |
| `catalog.bestSellers[3]` | top 3 titles + prices, no rank |
| `catalog.productsCount` | full catalog size |
| `tiktok.*` | present for ~30% of shops |
| `googleAds.liveAds`, `adsLaunched30d` | |
| `pagination.total` | **total sellers for this search** |

### 2.3 Free cohort size — 1 credit

```bash
curl -s -X POST "https://api.trendtrack.io/v1/shops/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" -H "Content-Type: application/json" \
  -d '{"search":"magnesium glycinate","searchType":"productName","limit":1}'
# -> pagination.total = 470
```

### 2.4 Shop detail — 1 credit, and the only source of long-window growth

```bash
curl -s "https://api.trendtrack.io/v1/shops/35596f7f-cc73-4494-9c67-a0acfec2ebda" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

Adds, over and above the search row:

- `traffic.growth90d`, `traffic.growth180d` ← **not in search results, and the best demand signal there is**
- `advertising.summary.avgActiveAds30d` ← TrendTrack's own 30-day average ad count
- `trustpilot.rating`, `trustpilot.reviewCount`
- `technology.apps[]` — installed Shopify apps, including subscription apps
- `socials.*` followers and `growth30d`
- `similarShops[]`

### 2.5 A shop's best-selling products — 1 credit flat

```bash
curl -s "https://api.trendtrack.io/v1/shops/35596f7f-cc73-4494-9c67-a0acfec2ebda/products?sortBy=popularity&order=asc&limit=100" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

`sortBy`: `popularity` (best-seller rank) | `price` | `createdAt`.
`offset` up to 10000.

Real response:

```json
{ "requestId": "...",
  "data": [
    { "id": "1994224707", "title": "Grass-Fed Whey Protein Isolate", "handle": "whey-protein-isolate",
      "productUrl": null, "price": 59.99, "currency": "USD", "rank": 1,
      "createdAt": "2015-08-05T21:42:56.000Z", "publishedAt": "2017-12-04T22:15:56.000Z" } ],
  "pagination": { "limit": 3, "offset": 0, "total": 60 } }
```

**This is a truncated best-seller feed, not the catalog**, and the truncation
varies wildly:

```
shop                    catalog   exposed   coverage
fittrbites.com             17        17       100%
transparentlabs.com        72        60        83%
nutralife.com.au           66        32        48%
arukah-wellness.com        69        12        17%
```

So "product not in this shop's feed" does **not** mean the shop doesn't sell it.

### 2.6 Lookalike shops — 1 credit per row, and weak

```bash
curl -s "https://api.trendtrack.io/v1/shops/35596f7f-cc73-4494-9c67-a0acfec2ebda/similar?limit=5" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

Transparent Labs' top "lookalike" at score 0.933 is `popeyestoronto.com`, a Toronto
retail store with 6k visits. **Don't build anything on `similarityScore`.**

---

## 3. Whose behaviour does each number measure?

This is the single most important distinction, and it decides everything.

| Measures the **seller** (effort) | Measures the **customer** (demand) |
|---|---|
| `advertising.activeAds`, `history`, `avgActiveAds30d` | `traffic.monthlyVisits`, `growth30d/90d/180d` |
| `googleAds.liveAds`, `adsLaunched30d` | `tiktok.profileMetrics.totalViews`, `totalLikes` |
| `tiktok.activity.activeAds` | `trustpilot.reviewCount` |

Ad counts say *the seller believes this works*. Traffic says *people showed up*.
They come apart, and badly:

```
blackgirlvitamins.co    ad spend up +39%     traffic down −25%
humehealth.com          3,361 ads running    traffic down −7%
```

So: **ads are supporting evidence; traffic is the demand signal.** A scoring model
that leans on ad counts will rank brands that are burning money.

---

## 4. Step 1, Stage A — where candidate products come from

You cannot search products by performance. Only shops are searchable by metrics.
So products have to fall out of a shop search first.

```
1. POST /v1/shops/query   — filter SHOPS by what you care about
     categoryIds, mainMarketCountries, minMonthlyVisits,
     adsTimePeriod=last30d, sortBy=growth30d|monthlyVisits
2. For each shop: catalog.bestSellers[3]      (free, already in the row)
     or GET /shops/{id}/products?limit=100    (1 credit, ranked + dated)
3. Normalise titles (§7) → candidate product strings
```

Two things to accept about this:

- Your candidate universe is **bounded by the shop filter you chose**. Products sold
  only by shops outside that filter are invisible.
- **Put a floor on visits.** Sorting shops by `growth30d` surfaces tiny-baseline
  explosions: a real row came back with `growth30d = 23.67`, meaning **+2367%**,
  which is a shop that went from almost nothing to slightly more than nothing.

---

## 5. Step 1, Stage B — score each candidate (F1–F6)

For each candidate product string, build a cohort and compute six features.

Fixed rules for all six:

- **Never treat a missing value as zero.** A missing value means "not measured".
  Compute each feature over the shops where it *is* observed, and record how many
  that was. Averaging a missing value in as 0 reads as "no demand" and is wrong —
  this matters most for TikTok, present for only **15 of 50** shops.
- **Take medians, not averages**, for anything across the cohort. One giant
  advertiser should not carry a dead product.

### F1 — Sustained ad spend (weight 25)

*Is money still behind it after weeks?*

**Split it in two**, because a single median is misleading here. Measured on a real
cohort: 25 of 50 shops run zero ads, so the median across everyone is **0.5** —
your highest-weighted feature would be ~0 for almost every product.

```
advertisers = shops in cohort with activeAds(last30d) > 0
F1_breadth  = count(advertisers) / count(cohort_sampled)        # 25/50 = 0.50
F1_depth    = median(activeAds over advertisers only)           # 24, not 0.5
F1          = log1p(F1_depth) * F1_breadth
```

`log1p(x) = ln(1+x)` — it stops a 1,000-ad brand counting 40× a 25-ad brand.

If you spend the extra credit on detail, `advertising.summary.avgActiveAds30d` is
TrendTrack's own 30-day average and is better than `activeAds` for `F1_depth`.

### F2 — Momentum (weight 25)

*Rising, or already peaked?* Two ratios, averaged over whichever are available.

**Ad momentum**, from the 26 weekly points in `advertising.history`:

```
v          = [weekly activeAds]                 # 26 points, oldest first
recent     = median(v[-4:])                     # last 4 weeks
prior      = median(v[-8:-4])                   # the 4 before that
ad_mom     = recent / prior                     # >1 scaling, <1 fading
```

**Use the median of the 4 weeks, not the mean.** Tested: the series
`[20,20,20,20, 20,20,20,900]` — one spike after seven dead weeks — passes a
mean-based threshold (mean = 240) and fails a median-based one (median = 20).
The median also stops a single missed week from killing a steady brand.

**Traffic momentum**, comparing the last month against the 90-day average month
(needs the detail call):

```
monthly_rate_90 = (1 + growth90d)^(1/3) - 1
traffic_mom     = (1 + growth30d) / (1 + monthly_rate_90)
```

```
F2 = mean of the ratios you actually have
     (skip missing; require at least one, and at least 8 weekly points for ad_mom)
```

### F3 — Adoption spread (weight 15)

*How many shops independently sell it?* **Costs 1 credit** — `pagination.total`
from a `limit=1` query.

This is **not** "more is better". One seller is unproven; 470 is a commodity.
Score it as a hump that peaks in the middle:

```
n  = pagination.total
F3 = exp( -( (ln(n) - ln(12))^2 ) / (2 * 0.9^2) )
```

Peaks at ~12 sellers, decays both directions. Tune the peak (12) to your appetite.

### F4 — Seller traffic growth (weight 15)

*Are the shops carrying it actually growing?* This is the **demand** feature, so
prefer long windows: six months of compounding traffic is much harder to fake with
one campaign than 30 days, and for repeat-purchase products it is the closest
thing to a retention signal the API offers.

Per shop (needs detail for `growth90d` / `growth180d`):

```
clip(x) = max(-0.9, min(x, 3.0))        # +2890% and +3354% are real values; cap them
shop_demand = 0.5*clip(growth180d) + 0.3*clip(growth90d) + 0.2*clip(growth30d)
F4          = median(shop_demand over cohort)
```

If you skip the detail call, F4 falls back to `median(growth30d)` and gets noisier.

### F5 — Channel breadth (weight 10)

*Confirmed on more than one platform?* Per shop, count channels **observed** and
channels **active**:

```
meta    observable always;   active if advertising.activeAds > 0
google  observable always;   active if googleAds.liveAds > 0
tiktok  observable if tiktok.hasTikTok is true;  active if tiktok.activity.activeAds > 0

F5 = mean over cohort of ( channels_active / channels_observable )
```

**Do not use `googleAds.status == "available"`.** It was `"available"` for
**50 of 50** shops — it never varies, so it carries no information. `liveAds > 0`
was true for 24 of 50, which does.

### F6 — Catalog prominence (weight 10)

*Do sellers treat it as a hero product, or a long-tail SKU?*

```
for each shop in cohort:
    GET /shops/{id}/products?sortBy=popularity&limit=100     # 1 credit
    coverage = pagination.total / catalog.productsCount
    if coverage < 0.5: mark UNKNOWN for this shop   # feed too shallow to conclude
    r = best rank among products whose normalised title matches the candidate
    if no match: mark UNKNOWN (not zero — the feed is truncated, §2.5)
    prominence = 1 / sqrt(r)        # rank 1 = 1.00, rank 4 = 0.50, rank 16 = 0.25

F6 = mean(prominence over shops where it is known)
```

**Collapse variants before taking the rank.** Real example — one product occupying
the entire podium:

```
#1  $235  Daily Ultimate Essentials Pro: All-in-One Supplement
#2   $89  Daily Ultimate Essentials Pro: All-in-One Supplement
#3  $235  Daily Ultimate Essentials Pro - Quarterly Refills
```

**Drop non-products first.** The feed contains things that are not products, and
they rank high — `10 Year Warranty` sits at **rank 2** in one shop:

```
healifeco.com        #2   24.9   10 Year Warranty
healthy-metal.com    #3      0   Healthy Metal Booklet
healthy-metal.com    #4      0   Healthy Metal Influencer Leaflet
im8health.com        #4     15   Logo White Cap
transparentlabs.com  #56  29.99  TL T-Shirt
```

Filter on title: `warrant|booklet|leaflet|gift ?card|sticker|t-?shirt|hoodie|cap|
sample|ebook|shipping|insurance|thank you card`, and drop `price == 0`.

### Combining them

Raw values are on different scales and have long tails, so don't average them
directly. Two steps:

```
1. log1p() the count-like features: F1_depth, F3's n
2. convert each feature to a percentile rank within the candidate pool:
       P(x) = (how many candidates score below x) / (pool size - 1)
   -> every feature is now 0..1 and immune to one extreme value
3. Score = 0.25*P(F1) + 0.25*P(F2) + 0.15*P(F3) + 0.15*P(F4) + 0.10*P(F5) + 0.10*P(F6)
```

Percentile ranking is what makes the weights mean what you intended. With raw
values, one product at +3354% growth would swamp all six features at once.

### Gates — applied BEFORE scoring, never as a penalty

A product failing these is **unmeasured**, not low-demand. Blending "no data" into a
weighted average silently reads as "medium demand".

```
drop if cohort n < 3
drop if no shop in the cohort has activeAds > 0 or googleAds.liveAds > 0
drop if median(monthlyVisits over cohort) < 1000        # kills tiny-baseline noise
mark F2 UNKNOWN if fewer than 3 shops have >= 8 weekly ad-history points
mark tiktok UNKNOWN (not 0) where hasTikTok is false
```

A note on the weights: **25/25/15/15/10/10 is a starting guess, not a result.** The
honest way to set them is to take 20–30 products you already know succeeded or
flopped, score them, and tune until the two groups separate. Any weight you can't
justify that way is a guess.

---

## 6. Step 2 — is that market saturated?

Step 1 answers *do people want it*. It does **not** answer *can you still get in*.
Those are different questions and the same product can score high on one and be
hopeless on the other.

Six saturation signals, all computable from calls you already made:

```
S1  seller density      ln(pagination.total)
S2  demand trend        median(growth180d) across cohort   (negative = shrinking)
S3  entrenchment        median age in years of the #1-ranked product across cohort,
                        from publishedAt
S4  new entrant rate    share of cohort shops with createdAt within 12 months
S5  price compression   p90/p10 of the matched product's price, same currency only
S6  ad pressure         median( activeAds / (monthlyVisits/10000) ) over advertisers
                        — how many ads are chasing each unit of traffic
```

Read them like this:

| Signal | Open market | Saturated market |
|---|---|---|
| S1 sellers | 5–30 | hundreds |
| S2 demand trend | rising | flat or falling |
| S3 entrenchment | #1 products are months old | #1 products are years old |
| S4 new entrants | some, steady | **0%** (nobody bothers) or a sudden flood (gold rush → about to close) |
| S5 price spread | wide (3×+) | narrow (commodity pricing) |
| S6 ad pressure | low | high — everyone buying the same traffic |

```
Saturation = 0.30*P(S1) + 0.25*P(-S2) + 0.20*P(S3) + 0.15*P(-S5) + 0.10*P(S6)
```

S4 is deliberately left out of the sum: it is **not** a straight line. Both extremes
are bad, so read it as a flag, not a score.

### Worked example, real numbers

```bash
curl -s -X POST "https://api.trendtrack.io/v1/shops/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" -H "Content-Type: application/json" \
  -d '{"search":"magnesium glycinate","searchType":"productName","limit":50,"adsTimePeriod":"last30d"}'
```

```
COHORT 'magnesium glycinate': 470 sellers indexed, 50 sampled
  median monthly visits          1,828
  median growth30d               -5.9%
  running Meta ads               25/50   median ALL=0.5   ADVERTISERS ONLY=24
  TikTok present                 15/50
  Google ads live                24/50
  weekly ad-history points       median 26
  shop age median                3.0y    created <12mo: 0/48 (0%)
  best-seller prices USD n=90    p10=$15.99  median=$28.24  p90=$59.99  spread=3.8x
```

Reading it:

- **S1 = 470 sellers.** Crowded. F3's hump scores this near zero too.
- **S2 = −5.9%** median 30-day traffic. The cohort is **shrinking**.
- **S4 = 0%** of shops created in the last 12 months, median shop age 3 years.
  Nobody new is entering — a mature market, not an emerging one.
- **S5 = 3.8×** price spread. Still some room; not fully commoditised.
- **S6**: half the cohort advertises, at a median of 24 live ads each.

**Verdict: saturated and mature.** Demand is real but flat, 470 sellers already
share it, and the absence of new entrants says the opportunity closed a while ago.
This is exactly the product a demand-only score would rank highly and you would
regret.

### The decision matrix

|  | Saturation low | Saturation high |
|---|---|---|
| **Demand high** | **Enter.** This is the target. | Crowded — only enter with a real differentiator (format, dose, bundle, audience) |
| **Demand low** | Too early, or dead. Check S4: new entrants arriving = early; none = dead | Avoid |

---

## 7. Making the cohort mean something

Everything above rests on the cohort being the right set of shops, and by default it
is just a text match. Two fixes, in order of value:

**Normalise the product string.** Strip dosages, counts, pack sizes and format
words; match on active ingredient + form:

```
"Magnesium Glycinate 400mg 120 Capsules"   ->  magnesium glycinate | capsule
"Mag Glycinate + Zinc, 1100mg"             ->  magnesium glycinate | capsule
"Magnesium Glycinate Drink Mix - 12 Servings" -> magnesium glycinate | powder
```

This makes the unit of analysis an *ingredient + format*, which is the right
granularity anyway: what gets reordered is a consumable, not a brand's packaging.

**Confirm membership where you can, but fail open.** A shop whose products feed is
shallow (coverage < 50%, §2.5) must be counted as UNKNOWN rather than excluded —
`arukah-wellness.com` matched the magnesium search while exposing only 12 of its 69
products. Excluding it would shrink every cohort and corrupt F3, F4 and F5.

**Free bonus signal.** 67 of 278 product titles (24%) state their own reorder
interval — `Quarterly Refills`, `30-Night Box`, `12 Servings`, `Complete Bundle`.
If you care about repeat purchase, that is evidence sitting in text you already
have, and it costs nothing.

---

## 8. The pipeline end to end

```
STAGE A — candidates                                    cost
  POST /v1/shops/query  (filter shops, limit 50)        50
  read catalog.bestSellers[3] from each row              0
  normalise titles -> ~30 candidate products             0

STAGE B — score each candidate                          per product
  POST /v1/shops/query  limit=1   -> n (F3)              1
  POST /v1/shops/query  limit=20  -> cohort sample      20
  gates: n>=3, any ads, median visits >= 1000            0
  GET  /v1/shops/{id}          x20  -> g90/g180, apps   20
  GET  /v1/shops/{id}/products x20  -> rank, price, age 20
  compute F1..F6, percentile-rank, weighted sum          0
                                                      ----
                                                        61

STAGE C — saturation, for the top ~5 only
  reuse everything already fetched                       0
  compute S1..S6, Saturation score                       0

OUTPUT: products ranked by demand, each tagged open / crowded / dead
```

30 candidates ≈ 1,830 credits, so about **5 full runs a month** on a 10,000 plan.

### Snapshot daily — the biggest single improvement

F1 ("still paying after **weeks**"), F2 and F6 all want history, and the API returns
point-in-time snapshots outside the two history arrays. Since search is billed per
row, **history you have already paid for should never be bought twice.**

Store every cohort pull in your own database from day one. Within a few weeks:

- F1 becomes literally measured instead of inferred
- F2 gets daily resolution instead of 4 weekly points
- **F6 gains rank movement over time** — which is the product-level demand signal
  TrendTrack does not sell, and the closest thing to a sales trend you can get
- the marginal cost of re-scoring drops to near zero

---

## 9. Traps, all verified

| Trap | Reality |
|---|---|
| Median ad count across a cohort | 25 of 50 shops run zero ads, so the median is **0.5**. Take the median over advertisers only |
| Treating missing TikTok as 0 | TikTok present for **15/50**. Missing ≠ zero |
| `googleAds.status` as a signal | `"available"` for **50/50**. No information. Use `liveAds > 0` |
| `adsTimePeriod` default | Defaults to `last24h`; **24/50** shops differ at `last30d`. One reads 0 vs 25 ads |
| `productUrl` | `null` in **278/278** products. Build it: `https://{domain}/products/{handle}` |
| `/products` = the catalog | It is a truncated best-seller feed: **17%–100%** of the catalog depending on shop |
| Everything in `/products` is a product | Warranties, booklets, leaflets, caps, t-shirts, gift cards — one warranty ranked **#2** |
| One product = one rank | Variants take several ranks; one product held **#1, #2 and #3** |
| Prices comparable | Four currencies in one cohort (USD/GBP/AUD/INR). An INR price looks 10× bigger |
| Growth values are small | `growth30d = 23.67` means **+2367%**. Clip, use percentiles, and floor by visits |
| `similarityScore` is useful | Top lookalike for a supplement brand was a Toronto retail store at 0.933 |
| Ad growth = demand | `blackgirlvitamins.co`: ads **+39%**, traffic **−25%** |
| Credits are per call | Per **row** on search and similar. Detail and products are flat |
