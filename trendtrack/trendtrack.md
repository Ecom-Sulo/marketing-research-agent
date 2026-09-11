---
title: API Reference
description: Browse the generated endpoint reference grouped by the main Trendtrack Public API resources.
---

<Callout title="Resource-based navigation">
  Use the left sidebar to browse the API by resource area instead of
  endpoint-by-endpoint. Each resource page lists every operation in that group
  with request and response samples.
</Callout>

## Jump to a resource

<DocCardGrid>
  <DocCard slug="reference/api/shops" title="Shops">
    Search Shopify stores, pull analytics, and inspect store-level traffic,
    product, and Meta ad signals.
  </DocCard>
  <DocCard slug="reference/api/ads" title="Ads">
    Query Meta/Facebook ad creatives. Filter by status, media type, sort, and
    pagination. Google Ads and TikTok items live under dedicated resources.
  </DocCard>
  <DocCard slug="reference/api/google-ads" title="Google Ads">
    Query Google Search, Shopping, Maps, YouTube, and Other ads. Filter by
    Google category, target country, reach, status, dates, and running time.
  </DocCard>
  <DocCard slug="reference/api/tiktok" title="TikTok">
    Search TikTok ads and organic videos with `/v1/tiktok/library`, advanced
    queries, item detail lookup, and shop-scoped TikTok library discovery.
  </DocCard>
  <DocCard slug="reference/api/advertisers" title="Advertisers">
    Look up Meta advertiser pages, their active ads, and aggregate performance
    signals tracked by Trendtrack.
  </DocCard>
  <DocCard slug="reference/api/brandtrackers" title="Brandtrackers">
    List workspace brandtrackers, resolve `brandtrackerId`, start with overview,
    then use `/top-ads?sortBy=currentRank` for current rank or
    `rankDelta7d|rankDelta14d|rankDelta30d` for movers. Scaling/ad-rank are
    legacy compatibility endpoints.
  </DocCard>
  <DocCard slug="reference/api/discovery" title="Discovery">
    Resolve a brand name, domain, Facebook page ID, or Instagram handle via `GET
    /v1/lookup` and pivot to linked brandtracker, advertiser, and shop resource
    IDs.
  </DocCard>
  <DocCard slug="reference/api/favorites" title="Favorites">
    Read and manage favorite ads, website/shop favorites, email favorites,
    folders, visibility, and ad/favorite-ad-folder share links.
  </DocCard>
  <DocCard slug="reference/api/workspace" title="Workspace">
    Retrieve metadata about the workspace attached to the API key making the
    call.
  </DocCard>
  <DocCard slug="reference/api/usage" title="Usage">
    Check remaining credits, billing period, and metered consumption for the
    current workspace.
  </DocCard>
  <DocCard slug="reference/api/identity" title="Identity">
    Inspect the owner and scopes of the API key presented in the request.
  </DocCard>
  <DocCard slug="reference/api/system" title="System">
    Probe public surface endpoints — health, metadata, shell routes, and
    freshness checks like `GET /v1/system/freshness` before production traffic.
  </DocCard>
  <DocCard slug="reference/api/emails" title="Emails">
    Endpoints for email-specific lookups and exports supported by the API.
  </DocCard>
</DocCardGrid>

## Common naming and filtering conventions

- Public API base URL: `https://api.trendtrack.io`.
- Public query surfaces use canonical sort fields `sortBy` and `order`.
- `GET /v1/ads` canonical query param is `search`; deprecated alias `query` is accepted for backward compatibility, but sending both `search` and `query` in one request returns a conflict validation error. Public `/v1/ads*` endpoints are Meta/Facebook-only; use `/v1/google-ads/*` for Google and `/v1/tiktok/*` for TikTok.
- `POST /v1/google-ads/query` accepts Google networks `search`, `shopping`, `maps`, `youtube`, and `other`. `categoryIds` uses IDs returned by `/v1/google-ads/facets/categories`; `audienceCountries` filters the countries targeted by the ad, not the advertiser's creation country. Returned Google Ads rows cost one ads credit each.
- Use `/v1/tiktok/library`, `/v1/tiktok/library/query`, `/v1/tiktok/library/{itemId}`, and `/v1/shops/{shopId}/tiktok/library` for TikTok ads and organic videos. Returned TikTok library rows are metered one credit per returned item.
- `GET /v1/advertisers` supports simple `categoryIds` filters. `POST /v1/advertisers/query` supports either `categoryIds` shorthand or `pageNiches` (not both). Empty `{}` bodies are valid for the POST query endpoint.
- `GET /v1/shops` supports `categoryIds`, `pixelIds`, `excludePixelIds`, `shopifyAppIds`, and `excludeShopifyAppIds` filters. Shop responses include additive `tiktok` presence/count fields when indexed; existing `advertising.activeAds`, `latestAds`, and linked advertisers remain Meta/Facebook semantics.
- `POST /v1/shops/query` with `searchType: "domain"` performs exact domain/related-domain matching from a domain or URL (no broad wildcard/text fallback). Use `searchType: "shopContains"` for broad website text discovery.
- `GET /v1/lookup` returns additive `signals` fields to help disambiguate close matches before metered calls.
- Workspace top-ads rows are nested objects `{ brandtracker, ad, metrics }` (not a flat ad row).
- Folder discovery is available on both `GET /v1/workspace/folders` and `GET /v1/brandtrackers/folders`.
- Email endpoints do **not** expose opens/clicks/conversions/revenue metrics. Email sort fields are discovery/indexing sorts, not “best-performing email” KPIs.
- For public ad 7-day scaling prompts, use the generated `POST /v1/ads/query` example named “Top ads scaling over the last 7 days” (`sortBy: "reachDelta7d"`, `reachPeriod: "last7d"`, `minReach: 1`) instead of adding first-seen date filters.
- For scaling workflows, advertiser `reachDelta7d` sorting is not supported; use supported advertiser sorts (`reach14d`, `activeAds`, etc.) or mover sorts on brandtracker/workspace top-ads.
- `reachPeriod` chooses the metric window used by reach/spend thresholds. By itself it does not filter unless paired with `minReach`, `maxReach`, or an endpoint-specific reach sort/filter.
- Brandtracker mutations are available through REST and MCP. Destructive MCP tools and REST bulk/folder delete endpoints require `confirm: true`; bulk and folder destructive operations count as one persistent create/delete quota operation while reporting the affected active-link count.
- Favorites support `ads`, `shops` (website/shop favorites), and `emails`. Public API endpoints use `/v1/favorites/shops` for website favorites; MCP uses `type: "shops"` for the same resource family.
- Favorites scope is explicit: `scope=workspace` reads or writes workspace favorites, while `scope=personal` requires a delegated-user credential. Workspace mutations require writer roles; readonly workspace members can read but cannot create, move, delete, reorder, change visibility, or create share links.
- Saved favorite row IDs come from list responses: ads currently use numeric saved-row IDs, shops use `favorite_websites.id` UUIDs, and emails use `favorite_emails.uuid` UUIDs. Email folder IDs and saved email IDs are UUIDs; internal numeric IDs are not public API identifiers.
- Folder delete endpoints require explicit contained-item semantics: `delete_items`, `move_items_to_root`, or `move_items_to_folder` with `targetFolderId` when needed. Visibility endpoints switch between `private` and `organization`; private conversion is denied if it would move another user’s contained favorites into personal scope.
- Favorite-folder capabilities: ads support items, folders, hierarchy, reorder, and visibility; shops support items, flat folders, and visibility (no hierarchy or reorder); emails support items, folders, hierarchy, reorder, and visibility.
- Share links are ads-focused: `POST /v1/ads/{adId}/share` creates or returns a raw ad share URL, and `POST /v1/favorites/ads/folders/{folderId}/share` creates or returns a favorite ad folder share URL. Shop/email share links are not exposed.

## Favorites REST examples

```bash title="List saved email favorites"
curl "https://api.trendtrack.io/v1/favorites/emails?scope=workspace&limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

```bash title="Create a shop favorite folder"
curl -X POST "https://api.trendtrack.io/v1/favorites/shops/folders" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scope":"workspace","name":"Competitor shops"}'
```

```bash title="Delete an ad favorite folder and move contained ads to root"
curl -X DELETE "https://api.trendtrack.io/v1/favorites/ads/folders/00000000-0000-0000-0000-000000000000?scope=workspace" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"move_items_to_root"}'
```

```bash title="Create a favorite ad folder share link"
curl -X POST "https://api.trendtrack.io/v1/favorites/ads/folders/00000000-0000-0000-0000-000000000000/share?scope=workspace" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

## TikTok REST examples

```bash title="List TikTok library items"
curl "https://api.trendtrack.io/v1/tiktok/library?search=collagen%20gummies&type=all&limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

```bash title="Advanced TikTok library query"
curl -X POST "https://api.trendtrack.io/v1/tiktok/library/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search":["collagen gummies"],"searchArea":"caption","type":"ad","status":"active","sortBy":"views","order":"desc","limit":10}'
```

```bash title="Get one TikTok library item"
curl "https://api.trendtrack.io/v1/tiktok/library/tiktok_7078586231734521093" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

```bash title="List TikTok library items for a shop"
curl "https://api.trendtrack.io/v1/shops/3f8aa146-6f96-46e8-9781-64db5166f9a8/tiktok/library?type=all&limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

## Google Ads REST examples

```bash title="Discover Google category IDs"
curl "https://api.trendtrack.io/v1/google-ads/facets/categories?search=clothing&limit=10" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY"
```

```bash title="Query US Shopping ads by Google category"
curl -X POST "https://api.trendtrack.io/v1/google-ads/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active",
    "networks": ["shopping"],
    "categoryIds": [24],
    "audienceCountries": { "include": ["US"] },
    "sortBy": "newest",
    "order": "desc",
    "page": 1,
    "limit": 10
  }'
```

```bash title="Search Google advertisers and filter by ad reach"
curl -X POST "https://api.trendtrack.io/v1/google-ads/query" \
  -H "Authorization: Bearer $TRENDTRACK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search": ["nike"],
    "status": "active",
    "minReach": 1000,
    "maxReach": 1000000,
    "sortBy": "reach",
    "order": "desc",
    "page": 1,
    "limit": 10
  }'
```

## Recommended workflow

1. Start with <DocLink slug="getting-started">Getting Started</DocLink> to obtain a key and make a first call.
2. Confirm <DocLink slug="authentication">Authentication</DocLink> so every subsequent request carries `Authorization: Bearer <key>`.
3. For brand/domain/Facebook page ID/Instagram handle questions, call `GET /v1/lookup?q=...` first (zero-credit), then pivot to the linked `brandtracker`, `advertiser`, or `shop` resource IDs.
4. For tracked-brand deep dives, use `GET /v1/brandtrackers/{brandtrackerId}/overview` first.
5. For rankings, use canonical top-ads calls: `GET /v1/brandtrackers/{brandtrackerId}/top-ads?sortBy=currentRank` or `GET /v1/workspace/top-ads?sortBy=currentRank`.
6. For rank movers, use `sortBy=rankDelta7d`, `rankDelta14d`, or `rankDelta30d`; use `reach`, `reachDelta1d`, `reachDelta7d`, or `reachDelta30d` for reach rankings.
7. Treat `/scaling-ads` and `/ad-rank` as legacy compatibility endpoints; their ES-backed responses may return an empty `trajectory`.
8. For freshness-sensitive historical workflows, check `GET /v1/system/freshness` (global) and `GET /v1/brandtrackers/{brandtrackerId}/snapshots` (brandtracker-level readiness).
9. Keep <DocLink slug="credits-and-billing">Credits &amp; Billing</DocLink>, <DocLink slug="rate-limits">Rate Limits</DocLink>, and <DocLink slug="errors">Errors</DocLink> open while integrating — you will hit them.
10. Drill into the resource pages above (or the sidebar) for the exact request shape of each operation, including brandtracker create-by-domain/shop aliases, folders, and workspace-link move/delete operations.

<Callout title="No in-page playground" type="info">
  The API reference does not ship a hosted playground. Copy the request sample
  on each operation, swap in your bearer API key, and run it from your own
  terminal or HTTP client. This keeps the reference fast to scan and avoids
  surprise network calls while you read.
</Callout>

Return to the <DocLink>docs overview</DocLink> for the guided entry point.
