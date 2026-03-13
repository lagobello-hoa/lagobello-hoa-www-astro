# Lago Bello HOA Website

Official website for the Lago Bello Home Owners Association at [lagohoa.org](https://lagohoa.org).

## Tech Stack

- **Framework:** [Astro](https://astro.build/) (static output)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **PDF Viewer:** [PDF.js](https://mozilla.github.io/pdf.js/) via pdfjs-dist (React island)
- **Deployment:** Cloudflare Pages (auto-deploys from `main` branch)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Adding Documents

1. Place PDF files in `public/documents/`
2. Add an entry to `src/content/documents.json` with title, slug, filename, category, date, and description
3. The document will automatically appear in the library and get its own viewer page

## Deployment

The site deploys to Cloudflare Pages automatically when changes are pushed to the `main` branch.

Cloudflare Pages settings:
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Node.js version:** 20
