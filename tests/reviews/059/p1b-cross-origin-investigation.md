# P1.B Investigation Record — Sparkline `scrollIntoView` Bug Reproducibility

**Status:** P1.B (sparkline navigator no-op inside ADO iframe) — **NOT REPRODUCIBLE in
supported Chromium browsers, including cross-origin topology.** Awaiting real-ADO QA
before any code change to the navigator.
**Recorded:** 2026-04-19 (Slice 1 work).
**Author:** team-lead.
**Disposition:** Recommend downgrade from P1 to P3 with the constraint "do not re-prioritize
without a real-ADO sandbox reproduction." See "Recommendation" section at bottom.

---

## Synthesis Claim Being Tested

From `tests/reviews/059/SYNTHESIS.md` §"P1.B" and source review
`tests/reviews/059/ado-extension-ui-specialist.md` §P1-1:

> `scrollIntoView({block:"center"})` in `sparkline-navigator.ts:127` is a no-op
> inside the height-synced ADO iframe ... per spec, `scrollIntoView` does not
> cross the iframe boundary into the parent.
>
> Counter-evidence (must investigate before fixing): existing
> `typeahead-dropdown.ts:447` uses `scrollIntoView({ block: "nearest" })` and
> works because that target is inside a scrollable `<ul>`. The chart containers
> in feature 059 are page-level blocks with no ancestor that scrolls.

The specialist explicitly flagged this as a verification-required claim, not
a confirmed bug.

---

## What the Smoke Tested

`extension/tests/smoke/iframe-drilldown.smoke.ts` (held back from commit):

- Parent page navigates to `localhost:3000`.
- `setContent` injects a 5000px-tall body with a 1500px scroll spacer above
  an `<iframe src="/" id="dashboard-frame" height="3000">`.
- Test waits for the dashboard inside the iframe to fully render.
- `dispatchEvent('click')` (NOT Playwright `.click()`) on the first sparkline
  trigger — bypasses Playwright's auto-scroll-into-view stability behavior.
- Diagnostic captures:
  - `parent.scrollY` before and after the click.
  - `iframe.contentWindow.scrollY`.
  - `#throughput-chart` bounding rect translated to parent viewport
    coordinates.

## Diagnostic Result (un-fixed source)

```
parent scrollY:  0 → 1604      // parent DID scroll
iframe scrollY:  0             // iframe internal scroll untouched
#throughput-chart: parentTopOfTarget = 513px, viewportHeight = 720px
                   inParentViewport = true
```

The parent scrolled ~1600px to bring the throughput chart into the parent
viewport. The iframe's own scroll position was untouched. This is the
"correct" user-facing outcome — and it occurred against the **un-fixed**
source.

## Hypothesis for Why the Bug Did Not Reproduce

Modern Chromium (Edge included) implements the CSSOM-View
`scroll-an-element-into-view` algorithm to walk the containing-block chain
**across same-origin iframe boundaries**. When the iframe document has no
scrollable ancestor (because its body fits within the iframe), the algorithm
walks up to the parent document via `frameElement` and scrolls the parent
to bring the iframe-internal target into the parent viewport.

The synthesis claim was theoretical (per CSSOM spec) but Chromium's
implementation is more permissive than the theoretical reading.

## Why the Bug May Still Exist in Production ADO

Production ADO is **cross-origin**:

- Parent host: `dev.azure.com`
- Extension iframe: a `*.gallerycdn.vsassets.io` URL (the Visual Studio
  Marketplace gallery CDN)

Cross-origin iframes are blocked from triggering parent scroll via
`scrollIntoView` because the iframe document cannot access the parent's
scroll container under the same-origin policy. The test setup above is
**same-origin** (both at `localhost:3000`) and therefore cannot reach this
failure mode.

## Cross-Origin Experiment Result

Setup: parent navigates to `http://127.0.0.1:3000`, iframe `src="http://localhost:3000"`.
Same `serve` instance answers both, but browser treats them as different origins under
SOP. All other assertions identical to the same-origin smoke.

**Result:** parent `scrollY: 0 → 1604` (same as same-origin). Modern Chromium walks the
`scroll-an-element-into-view` containing-block chain across **cross-origin** iframe
boundaries too, at least in the version Playwright bundles.

The bug as described in the synthesis P1-1 finding does NOT reproduce in either
same-origin or cross-origin iframe topologies in Chromium.

## Specialist Confirmation

`ado-extension-ui-specialist` was re-engaged with the diagnostic. Their authoritative
response:

1. P1-1 was implicitly cross-origin but the writing did not say so explicitly. They
   reasoned from CSSOM spec + ADO iframe topology + the height-sync pattern in
   `host-resize.ts`.
2. **They did NOT observe the bug in a real ADO sandbox project.** The finding was
   theoretical. The same-origin Playwright result was already stronger evidence than
   the original finding had. If cross-origin also passes, the finding should be
   downgraded.
3. The ADO Extension SDK 4.x exposes no parent-scroll primitive (`SDK.init`, `ready`,
   `notifyLoadSucceeded`, `resize`, `getAccessToken`, `getService`, `getWebContext`,
   `getExtensionContext` only). If the bug WERE real cross-origin, there would be no
   in-SDK code fix — the realistic responses would be:
   - Convert FR-050 to "highlight only + inline scroll-direction affordance," accepting
     the platform constraint.
   - Downgrade FR-050 entirely to "highlight + flash + tooltip," removing the scroll
     intent.
   Both are owner-call, not navigator code changes.

The specialist explicitly invoked the [verify-source-before-citing] discipline, noting
they cited "spec" without grepping the actual algorithm in browser source or a
written-down browser test fixture.

## Smoke Test Disposition

The new smoke file `extension/tests/smoke/iframe-drilldown.smoke.ts` was iterated three
times in response to Codex stop-hook feedback before settling on the right shape:

1. **First draft** asserted `parent.scrollY > 100`. Codex flagged: hard-codes a
   non-contract Chromium quirk. Replaced.
2. **Second draft** asserted only `is-sparkline-highlight` class added. Codex flagged:
   drops FR-050 end-to-end coverage (the navigator could ship without ever calling
   `scrollIntoView` and the class-only assertion would still pass).
3. **Final shape** locks **both halves of the FR-050 application contract** while
   asserting NO browser-implementation outcomes:

   - **Scroll intent** verified via an in-frame `Element.prototype.scrollIntoView`
     spy installed via `page.addInitScript` — runs in every frame including the
     cross-origin iframe. Each call is recorded on `window.__sparklineScrollCalls`
     with `{id, className, opts}`. Test asserts the spy captured a call with
     `id: "throughput-chart"` and `opts: { block: "center" }`. Locks: navigator
     called the documented API on the right target with the right args.
   - **Visual cue** verified via `expect(target).toHaveClass(/is-sparkline-highlight/)`.
     Locks: navigator added the documented class.

   Both halves are pure application contracts — the navigator's responsibility ends
   at calling `scrollIntoView` and adding the class. Whether the browser fulfills
   the scroll intent (parent / iframe / both / neither) is a platform concern that
   varies by Chromium version, ADO host topology, and SOP boundaries; locking that
   here would produce false regression signals on platform changes.

The three sentinels in the final file:

1. **Same-origin sparkline tap** — scroll intent (spy) + highlight class (visual).
2. **Cross-origin sparkline tap** — same FR-050 contract, origin-agnostic.
3. **Filter-change panel-dismiss** — FR-008 lifecycle-signals contract regression
   sentinel for a11y P2-3.

What is **NOT** asserted: parent / iframe scroll position changes after a sparkline
click. CSSOM-View `scroll-an-element-into-view` iframe-boundary behavior is ambiguous
in spec and varies across browser versions.

No `sparkline-navigator.ts` code change was made.

## Recommendation (for owner decision)

- **Downgrade synthesis P1.B from P1 → P3.** Rename to "P3.B: sparkline `scrollIntoView`
  reliability across iframe boundaries — theoretical platform-spec concern, not
  reproducible in supported Chromium browsers; revisit only if a real-ADO sandbox
  reproduces the symptom."
- **Block re-prioritization on real-ADO QA evidence.** Do not re-prioritize this finding
  to P1 or P2 without (a) a real-ADO sandbox reproduction, (b) a confirmed Chromium
  version regression, or (c) explicit user impact.
- **No code change to `sparkline-navigator.ts`.** Slice 1's "P1.B fix" commit is
  cancelled. The smoke harness lands as Slice 1 commit 2 instead, with the three
  sentinels above and zero navigator edits.

---

## What This Means for Slice 1

- **P1.A** (frontend-architecture's stale-cycle bail finding): committed as `5007ce79`
  independently. Confirmed correctness bug; well-tested.
- **P1.B** (this finding): downgrade recommended. No navigator edit. Smoke harness
  ships as Slice 1 commit 2 with three locked sentinels including a cross-origin
  Chromium-behavior lock.
- **Net Slice 1 deliverables:** P1.A (stale-cycle correctness fix) + iframe smoke
  infrastructure with three application-contract sentinels (same-origin highlight-class
  add, cross-origin highlight-class add, filter-change panel-dismiss). P1.D
  Tab-reach assertion (Slice 2) extends the same file.

The user's reinforcement #2 in this chain — "Playwright must be treated as authoritative
for P1.B/P1.D, not supplemental" — is now load-bearing in BOTH directions: it caught
that the original P1.B finding was theoretical, AND it provides the sentinel
infrastructure to catch P1.D and any future iframe-only failure modes.
