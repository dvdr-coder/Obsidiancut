# Obsidian Cut — Documentation & Architecture Website (`docs/`)

A complete, zero-build static website explaining Obsidian Cut's architecture, codebase, interactive audio/video pipelines, multi-platform installation, REST API, and `autoengine` batch CLI.

## Folder Contents

| File | Purpose |
| :--- | :--- |
| `index.html` | Semantic HTML5 documentation site with sticky navigation, search bar, interactive diagrams, playgrounds, and API tables |
| `styles.css` | Responsive Dark/Light theme styling, CSS grid layouts, print rules, and code/diagram theming |
| `diagrams.js` | Interactive SVG architectural diagrams (3-Tier System Blueprint, Audio/RTA Pipeline, FFmpeg Render DAG) |
| `docs-data.js` | Structured JSON-style dataset containing all 32+ source file explanations, parity table, 13 API routes, install scripts, and shortcuts |
| `app.js` | Interactive diagram inspector, search/filter engine, live HTML5 Canvas simulators (Waveform Trim, 32-Band RTA Spectrum + EQ, Crossfade Curves), and clipboard helpers |

## Preview Locally

You can open `docs/index.html` directly in any browser (`file://`), or serve it locally:

```bash
# Python 3 static server
python3 -m http.server 8080 --directory docs
# Visit http://localhost:8080
```

## Deploying as Your Website

Because `docs/` has **zero build steps and zero external CDN dependencies**, you can deploy the folder directly to any static host:
- **GitHub Pages**: Publish directly from the `/docs` folder in your repository settings.
- **Netlify / Vercel / Cloudflare Pages**: Set the publish/output directory to `docs`.
- **Nginx / Apache**: Point your document root to `docs/`.

## Customizing Content

- **Edit copy, add files, or update API examples**: Modify `docs-data.js`.
- **Edit or add architectural SVG diagrams**: Update `diagrams.js`.
- **Change branding colors or fonts**: Edit CSS variables at the top of `styles.css`.
