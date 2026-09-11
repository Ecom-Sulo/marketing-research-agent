---
name: trendtrack-shops-api
description: Query the TrendTrack Public API "Shops" endpoints — browse/search shops, run advanced filtered shop queries, find similar shops, get a single shop's full detail, list a shop's linked advertisers, pull a shop's social follower history, and list a shop's best-selling products. Use this whenever the user wants e-commerce/DTC shop intelligence from TrendTrack: discovering Shopify stores, filtering by traffic/ads/TikTok/Trustpilot/technology, competitor lookalikes, ad-spend or advertiser data for a store, or a store's product catalog. Trigger it even when the user just names a shop domain and asks about its traffic, ads, tech stack, socials, or products, or asks to "find shops like X".
---

# TrendTrack Public API — Shops

Endpoints for discovering and inspecting e-commerce shops (primarily Shopify DTC stores) tracked by TrendTrack.

## Base URL & authentication

- **Base URL:** `https://api.trendtrack.io`
- **Auth:** every request needs a bearer API key header:
  ```
  Authorization: Bearer <api_key>
  ```
- Never hardcode the key. Read it from an environment variable (e.g. `TRENDTRACK_API_KEY`) and fail clearly if it's missing.
- Missing/invalid keys return `401` with error code `missing_api_key`. Insufficient plan/permissions return `403`.

## Endpoint index

| # | Purpose | Method & path |
|---|---------|---------------|
| 1 | Browse / simple search of shops | `GET /v1/shops` |
| 2 | Advanced filtered shop query | `POST /v1/shops/query` |
| 3 | Shops similar to a domain or shop id | `GET /v1/shops/{identifier}/similar` |
| 4 | Full detail for one shop | `GET /v1/shops/{shopId}` |
| 5 | Advertisers linked to a shop | `GET /v1/shops/{shopId}/advertisers` |
| 6 | Shop social follower history | `GET /v1/shops/{shopId}/socials/history` |
| 7 | Shop best-selling products | `GET /v1/shops/{shopId}/products` |

**Choosing between #1 and #2:** use `GET /v1/shops` for the default discovery path (broad search, pagination, sorting, and a stable subset of filters). Use `POST /v1/shops/query` for the full advanced filtering contract, or when you need **exact** domain matching (`searchType: "domain"`) or growth-condition filters.

---

## 1. List shops — `GET /v1/shops`

Lightweight browse surface: broad search, pagination, sorting, and a stable subset of filters.

**Query parameters** (all optional):

- `search` (string) — broad identity search matched against domain, related domains, and shop name. For **exact** domain matching use endpoint #2 with `searchType="domain"`.
- `sortBy` (string, default `monthlyVisits`) — one of: `monthlyVisits`, `activeAds`, `growth30d`, `productsCount`, `createdAt`, `tiktokFollowers`, `tiktokActiveAds`, `tiktokTotalPosts`, `tiktokAvgActiveAds7d`, `tiktokAvgActiveAds30d`.
- `order` (string, default `desc`) — `asc` | `desc`.
- `offset` (int, default `0`, `>= 0`) — pagination offset.
- `limit` (int, default `32`, `1–100`) — page size.
- Traffic: `minMonthlyVisits`, `maxMonthlyVisits` (int `>= 0`).
- Ads: `minActiveAds`, `maxActiveAds` (number `>= 0`, metric follows `adsTimePeriod`); `adsTimePeriod` (default `last24h`) — `last24h` | `last7d` | `last30d`.
- TikTok: `hasTikTok` (bool); `minTikTokFollowers`/`maxTikTokFollowers`, `minTikTokActiveAds`/`maxTikTokActiveAds`, `minTikTokTotalPosts`/`maxTikTokTotalPosts` (number `>= 0`).
- Catalog: `minProductsCount`, `maxProductsCount` (int `>= 0`).
- Dates: `createdAfter`, `createdBefore` (string, `date` format, inclusive bounds).
- Platform/tech: `isShopifyPlus` (bool); `categoryIds` (int[]); `pixelIds`, `excludePixelIds` (string[], stable ids not display names); `shopifyAppIds`, `excludeShopifyAppIds` (int[]).
- Locale: `languages` (string[]), `currencies` (string[]) — repeated params or comma-separated.
- Trustpilot: `minTrustpilotRating`/`maxTrustpilotRating` (number `>= 0`), `minTrustpilotReviewCount`/`maxTrustpilotReviewCount` (int `>= 0`).

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops?search=earplugs&sortBy=monthlyVisits&limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: ShopSummary[], pagination }`. See [Shared shapes](#shared-shapes).

---

## 2. Query shops — `POST /v1/shops/query`

Canonical route for complex filtering/sorting. Returns the same `ShopSummary` contract as #1. `searchType="domain"` does exact domain/related-domain matching and does **not** fall back to wildcard/text matching.

**Request body** (`application/json`, all optional):

- `search` (string) — for `searchType="domain"` send a domain or URL; for broad website text use `searchType="shopContains"`; for product text use `searchType="productName"`. Do **not** send legacy keys `name`, `domain`, or `domains`.
- `searchType` (string) — `domain` | `productName` | `shopContains`.
- `sortBy` (string) — `relevance` (falls back to `monthlyVisits` when no scored text query), `monthlyVisits`, `activeAds`, `growth30d`, `productsCount`, `createdAt`, `tiktokFollowers`, `tiktokActiveAds`, `tiktokTotalPosts`, `tiktokAvgActiveAds7d`, `tiktokAvgActiveAds30d`.
- `order` (string) — `asc` | `desc`.
- `offset` (number `>= 0`), `limit` (number `1–100`).
- Revenue: `minEstimatedRevenue`, `maxEstimatedRevenue` (number `>= 0`, approximate indexed model).
- Traffic: `minMonthlyVisits`, `maxMonthlyVisits`.
- Catalog: `minProductsCount`, `maxProductsCount`; `minBestSellerPrice`, `maxBestSellerPrice`.
- Dates: `createdAfter`, `createdBefore` (`date`).
- Markets (ISO 3166-1 alpha-2, uppercase): `mainMarketCountries`, `marketCountries`, `excludeMarketCountries`, `creationCountries`, `excludeCreationCountries` (string[]).
- Ads: `minActiveAds`, `maxActiveAds`; `adsTimePeriod` — `last24h` | `last7d` | `last30d`.
- TikTok: `hasTikTok` (bool); `minTikTokFollowers`/`maxTikTokFollowers`, `minTikTokActiveAds`/`maxTikTokActiveAds`, `minTikTokTotalPosts`/`maxTikTokTotalPosts`.
- Platform/tech: `isShopifyPlus` (bool); `categoryIds` (number[]); `themeIds` (string[], ids); `pixelIds`, `excludePixelIds` (string[], ids); `shopifyAppIds`, `excludeShopifyAppIds` (number[]).
- Trustpilot: `minTrustpilotRating`/`maxTrustpilotRating`, `minTrustpilotReviewCount`/`maxTrustpilotReviewCount`.
- Locale: `languages` (string[]), `currencies` (string[]).
- `displayInTrending` (bool) — restrict to shops in TrendTrack's trending feed.
- `dtcRegion` (string) — `all` | `us` | `eu` (`us`/`eu` also apply the matching creation-country subset).
- Growth conditions — arrays of condition objects, each `{ period, comparison, value }` with an optional `operator` linking to the next condition:
  - `trafficGrowth`, `adsGrowth`, `pageReachGrowth`, `adReachGrowth`.

**Example** (find one shop by exact domain/URL)
```bash
curl -X POST "https://api.trendtrack.io/v1/shops/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search": "https://www.allbirds.com/products",
    "searchType": "domain",
    "limit": 10,
    "offset": 0
  }'
```

**Response:** `200` → `{ requestId, data: ShopSummary[], pagination }`.

---

## 3. List similar shops — `GET /v1/shops/{identifier}/similar`

Paginated lookalikes for a shop, resolved from a canonical domain **or** a public shop id / website UUID.

**Path parameter**
- `identifier` (string, required) — canonical shop domain or stable public shop id / website UUID.

**Query parameters** (optional)
- `sortBy` (string) — `relevance`, `monthlyVisits`, `activeAds`, `growth30d`, `productsCount`, `createdAt`.
- `order` (string, default `desc`) — `asc` | `desc`.
- `offset` (int, default `0`, `>= 0`).
- `limit` (int, default `32`, `1–100`).

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops/example.com/similar?limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: Array<{ shop: ShopSummary, similarityScore: number }>, pagination, meta: { shopExists: boolean } }`.

> Note: if the resolved shop isn't in the similar-shops engine, the call still returns `200` with `data: []` and `meta.shopExists = false` — treat that as "no lookalikes", not an error.

---

## 4. Get a shop by id — `GET /v1/shops/{shopId}`

Full hybrid detail read model for one shop — richer than `ShopSummary` (adds Trustpilot, per-network socials, technology stack, extended traffic growth, advertiser summary, and embedded `similarShops`).

**Path parameter**
- `shopId` (string, required) — stable public shop identifier.

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops/3f8aa146-6f96-46e8-9781-64db5166f9a8" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: ShopDetail }`. `ShopDetail` extends `ShopSummary` with, notably:
- `profile.defaultLanguage`
- `trustpilot`: `{ rating, reviewCount, brandName, brandLogo, url }`
- `socials`: per-network `{ handle, followers, growth30d }` for `facebook`, `instagram`, `tiktok`, `youtube`, `pinterest`, `linkedin`, `twitter`
- `catalog.categories` (string[]), `catalog.myShopifyDomain`
- `traffic.growth90d`, `traffic.growth180d`, `traffic.mainMarkets[]`
- `advertising.linkedAdvertisers[]`, `advertising.summary`, `advertising.adsCountryStats[]`
- `technology`: `{ theme, apps[] {id,label,iconUrl}, pixels[] {id,name,iconUrl,categories[]} }`
- `similarShops[]`: `{ shop: ShopSummary, similarityScore }`

---

## 5. List advertisers linked to a shop — `GET /v1/shops/{shopId}/advertisers`

Linked advertiser summaries for one shop.

**Path parameter**
- `shopId` (string, required).

**Query parameter** (optional)
- `limit` (int, default `100`, `1–100`).

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops/3f8aa146-6f96-46e8-9781-64db5166f9a8/advertisers" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: Advertiser[] }` where each `Advertiser` is
`{ id, platform, facebookPageId, name, isPrimary, activeAds }`.

---

## 6. Get shop social follower history — `GET /v1/shops/{shopId}/socials/history`

Follower time-series for **Facebook and Instagram** on the shop's linked advertiser page. Other networks are handle-only today and not returned here.

**Path parameter**
- `shopId` (string, required).

**Query parameters** (optional)
- `period` (string) — `day` | `week` | `month` (week/month pick the last raw snapshot of each bucket).
- `days` (int, default `90`, `7–365`) — rolling lookback ending at the latest snapshot.

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops/3f8aa146-6f96-46e8-9781-64db5166f9a8/socials/history?period=week&days=180" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: { facebook: TimePoint[], instagram: TimePoint[] } }` where `TimePoint` is `{ period, value }`.

---

## 7. List shop products — `GET /v1/shops/{shopId}/products`

Paginated best-selling Shopify products for one shop (from the shop's best-seller feed).

**Path parameter**
- `shopId` (string, required).

**Query parameters** (optional)
- `limit` (int, default `32`, `1–100`).
- `offset` (int, default `0`, `0–10000`).
- `sortBy` (string) — `popularity` (best-seller rank), `price`, `createdAt` (Shopify product creation date).
- `order` (string) — `asc` | `desc`. Defaults to `asc` for `popularity`, `desc` otherwise.

**Example**
```bash
curl -X GET "https://api.trendtrack.io/v1/shops/3f8aa146-6f96-46e8-9781-64db5166f9a8/products?sortBy=popularity&limit=20" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

**Response:** `200` → `{ requestId, data: Product[], pagination }` where each `Product` is
`{ id, title, handle, imageUrl, productUrl, price, currency, rank, createdAt, publishedAt }`.

---

## Shared shapes

### `pagination`
```json
{ "limit": 32, "offset": 0, "total": 128 }
```
Paginate by increasing `offset` by `limit` until `offset + data.length >= total`.

### `ShopSummary` (returned by #1, #2, and nested in #3/#4)
```json
{
  "id": "3f8aa146-6f96-46e8-9781-64db5166f9a8",
  "domain": "example.com",
  "name": "Example Shop",
  "screenshotUrl": "https://.../example.com.png",
  "createdAt": "2024-01-15T00:00:00.000Z",
  "profile": { "countryCode": "US", "currency": "USD", "isShopifyPlus": true },
  "catalog": {
    "productsCount": 124,
    "mainCategory": "Fashion",
    "bestSellers": [ { "imageUrl": "...", "title": "...", "price": 19.95, "currency": "EUR" } ]
  },
  "traffic": {
    "monthlyVisits": 45231,
    "growth30d": 0.18,
    "history": [ { "period": "2026-03-01", "value": 2942350 } ],
    "topCountries": [ { "countryCode": "US", "share": 0.64 } ]
  },
  "advertising": {
    "activeAds": 12,
    "linkedAdvertisersCount": 2,
    "history": [ { "period": "2026-03-01", "value": 2942350 } ],
    "topCountries": [ { "countryCode": "US", "share": 0.64 } ]
  },
  "tiktok": {
    "hasTikTok": true,
    "pageId": "6802334614847603717",
    "handle": "examplebrand",
    "profileMetrics": { "followers": 128430, "totalPosts": 342, "newPosts": 12, "totalViews": 9823431, "totalLikes": 456789 },
    "activity": { "activeAds": 7, "totalAds": 33, "avgActiveAds7d": 5.5, "avgActiveAds30d": 4.25 },
    "lastUpdatedAt": "2026-06-05T08:30:00.000Z"
  },
  "googleAds": {
    "status": "available",
    "liveAds": 14,
    "adsLaunched30d": 5,
    "reach": { "value": 245000, "label": "Google reported reach", "euUkOnly": false },
    "topCountries": [ { "code": "FR", "ads": 12, "reach": 185000 } ],
    "platformMix": [ { "platform": "SEARCH", "ads": 8 } ]
  },
  "latestAds": [
    { "id": "facebook_1059447873925448", "mediaType": "video", "mediaUrl": "...", "thumbnailUrl": "..." }
  ]
}
```

## Errors & conventions

- Every response (including errors) carries a `requestId` — log it when reporting failures.
- Error body shape:
  ```json
  {
    "error": {
      "code": "missing_api_key",
      "message": "Provide an API key using Authorization: Bearer <api_key>.",
      "requestId": "...",
      "details": { "validationErrors": [ { "field": "query-string.limit", "location": "query-string", "expected": ["limit must not be greater than 100"] } ] }
    }
  }
  ```
- Common statuses: `400` invalid input, `401` missing/invalid key, `403` not permitted, `404` shop not found (id-scoped endpoints), `500` server error, `503` service unavailable. On `429`/`503`, back off and retry.
- Respect the documented ranges (e.g. `limit` max `100`, `products.offset` max `10000`) to avoid `400`s.
- Country codes are ISO 3166-1 alpha-2; growth fields are fractional (`0.18` = +18%); ad metrics follow the `adsTimePeriod` you pass.
