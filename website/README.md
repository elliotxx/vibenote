# Vibenote website

Official marketing landing page for [Vibenote](https://github.com/elliotxx/vibenote). Static-first, self-contained under `website/` — independent from the Electron/Vue desktop app build.

## Local development

```sh
cd website
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Production build

```sh
cd website
npm install
npm run build
```

Static files are written to `website/dist/`. Preview locally:

```sh
npm run preview
```

## Deploy notes

- **Vercel**: set the project Root Directory to `website`, build command `npm run build`, output `dist`.
- **GitHub Pages**: publish the contents of `website/dist` (or point Pages at that folder after CI build). If the site is served from a subpath, set Vite `base` in `vite.config.ts` accordingly.

No server runtime or API keys are required.
