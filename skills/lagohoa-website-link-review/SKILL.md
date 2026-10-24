---
name: lagohoa-website-link-review
description: "Verify HOA website links and editorial context."
version: 0.1.0
author: Vittorio, with Hermes Agent
---

# Lago HOA website link review

## When to Use
Use to inspect public outbound links from the HOA website to the developer's community site, or draft a scoped editorial anchor improvement. This skill is HOA-owned and lives under the HOA organization; it is not a generic license to turn association pages into sales advertising.

## Prerequisites
- Confirm actual deployed source and public page. A stale/empty similarly named repository is not deployment proof.
- Read current site README and existing content/components. Confirm the allowed scope: read-only link audit, source draft, preview or approved publication.
- Keep account settings, private member data and operational HOA policy outside this public-safe skill.

## Procedure
1. **Read live rendered evidence.** Inspect the exact public HOA URL and enumerate relevant anchors, their href, visible text and rel attributes. Compare with source where source identity is verified.
2. **Classify attributes accurately.** `noopener noreferrer` is not `nofollow`. Record `nofollow`, `sponsored` or `ugc` only if actually present; do not claim any search-ranking outcome from link presence alone.
3. **Check destination relevance.** Verify developer/community links resolve to the intended page with useful resident/community context. Do not rely on old observed URL lists as current link inventory.
4. **Draft natural wording.** Prefer contextual anchors over repetitive sales keywords; clarify vague article links when supported by the page. Preserve HOA identity and editorial purpose. Do not make legal, property, availability or search-performance claims without source evidence.
5. **Label provenance.** If deployed source is unavailable, label suggested snippets as a rendered-page draft, not a checked-in source diff. If editing source, state actual files and revision.
6. **Validate the approved change.** Inspect current package scripts and build instructions; the current Astro source supports `npm run build`. Verify affected rendered pages and outbound destinations. Use the shared cloud deployment skill only if publication is explicitly approved; HOA account/domain bindings remain HOA-owned.
7. **Report exact outcome.** Distinguish live audit, local draft, preview and production. Read back the exact live anchor after approved publication; do not call a source edit deployed.

## Pitfalls
- A public source repository may contain generated/admin assets; audit only the requested page scope and do not infer deployed access controls.
- HOA governance/financial/member records are not material for public SEO content.
- Authorized cross-entity developer access does not merge the entities' publication identity or approval boundaries.

## Verification
- Current href/text/rel observations are recorded accurately without private data.
- Any draft is identified as source-based or rendered-page-only.
- Builds and live-publication claims are supported by actual output/readback.
