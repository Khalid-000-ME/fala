# Fala media kit

Generated as a cohesive raster-first brand set for the product described in `FALA_PRD.md`. The source art direction uses editorial whitespace, retro-futurist photography, halftone grain, black/white fields, electric blue, coral, and restrained chartreuse accents. None of the reference brands, layouts, or copy were reproduced.

## Visual language

- Chrome figure or hand: the AI agent.
- Black stone cube: the onchain vault and policy boundary.
- Blue paths: authorized transactions.
- Coral paths: hostile or disallowed requests.
- Transparent sphere or plane: enforcement that cannot be persuaded.
- Chartreuse marks: live system state.

## Asset map

| File | Dimensions / duration | Recommended use | Crop notes |
| --- | --- | --- | --- |
| `fala-hero-policy-tether.png` | 1672×941 | Landing hero, dashboard welcome, README cover | Put headline at left; preserve the figure and vault at center-right. |
| `fala-policy-boundary.png` | 1254×1254, alpha | Agent policy, allowlist, caps, empty states | Square or 4:5 card; retains a transparent outer field. |
| `fala-two-key-approval.png` | 1536×1024 | Pending approvals, auditor explanation | Best at 3:2; center crop around the paired authorization halves. |
| `fala-red-team-proof.png` | 1672×941 | Attack log, scoreboard, social preview | Works on dark sections; leave upper-left available for live HTML copy. |
| `fala-transaction-field.png` | 1672×941 | Activity-feed backdrop, footer, loading/empty state | Use at low opacity behind cards; safe to crop broadly. |
| `fala-transaction-field-loop.mp4` | 1920×1080, 8 s | Muted looping ambient section background | Use `autoplay muted loop playsinline`; respect `prefers-reduced-motion` by falling back to the PNG. |

## Usage guidance

- Keep all product copy, amounts, addresses, badges, and metrics as live HTML. The media deliberately contains no text.
- Use one dominant image per viewport. The square policy image is supporting art, not a second hero.
- Suggested treatments: 24–32 px corner radius; `object-fit: cover`; very light grain retained; avoid extra gradients over the coral/blue signals.
- For the motion loop, provide `fala-transaction-field.png` as the poster image and disable autoplay for reduced-motion users.
- The PNGs are the generated masters. Export smaller AVIF/WebP derivatives in the app's production image pipeline when available.

## Generation prompts

All images were generated with the built-in image generation tool, using the three supplied screenshots as style-only references. Core prompt constraints shared by the set: premium editorial photography, subtle halftone/film grain, warm off-white or near-black fields, graphite/chrome materials, cobalt authorized paths, coral blocked paths, minimal chartreuse accents; no text, logo, watermark, coins, generic padlocks, or UI screenshots.

The individual prompts specified: a tethered agent landscape for the hero; a hand-held transparent policy boundary for policy configuration; two independent authorization halves for approvals; abstract hostile signals breaking at a boundary for red-team proof; and a low-density topographic transaction field for ambient use.
