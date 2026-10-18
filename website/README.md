# Orion landing page

A static landing page with Orion's actual live liquid-metal renderer, official branding, local demo video, Windows/Linux download links, and no analytics, external fonts, or CDN dependencies. The small optional GitHub API request refreshes the latest release links; static fallback links work when it fails or JavaScript is disabled.

## Preview locally

From the project root:

```powershell
bun website/build.mjs
bun website/serve.mjs
```

Open `http://127.0.0.1:4173`. Edit `website/index.html`, `website/styles.css`, and `website/site.ts`, then rebuild. The animation shares `src/renderer/welcomeArt.ts` with the app.

## GitHub Pages, without adding an Actions workflow

GitHub Pages' branch publishing supports the branch root or `/docs`; it cannot select `/website` directly. Prepare a publishable copy locally:

```powershell
bun website/prepare-pages.mjs
```

This builds the site and copies `index.html`, `.nojekyll`, and `assets/` into the existing `docs/` folder. It does not remove the Markdown guides. Review and push those changes using Velo:

```powershell
velo seal "docs: publish Orion landing page"
velo push
```

Then open repository **Settings → Pages → Build and deployment**:

1. Source: **Deploy from a branch**.
2. Branch: **main**; folder: **/docs**.
3. Save.

The expected site URL is `https://quietsource.github.io/Orion/`. Relative asset links work with that repository subpath. No workflow file is added. GitHub still manages the Pages deployment itself.

After future website edits, run the preparation command again before pushing. If you use a custom domain, update the social image URL in `index.html`.

## Assets and content

- `assets/demo.mp4`: the current Orion demo supplied by the project owner.
- `assets/demo-poster.jpg`: a still from that demo.
- `assets/icon.png`, `assets/metal.png`: generated from the official app artwork.
- `assets/social.png`: social sharing preview.
- `assets/site.js`, `assets/site.css`: checked-in static browser assets, built with Bun.

Download links fall back to release `0.1.9`. Update them in `index.html` when retiring that release. The page makes no claim that model inference is free of hardware requirements, that hosted APIs are local, or that model weights/generated media are encrypted.
