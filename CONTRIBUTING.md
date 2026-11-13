# Contributing

Thanks for helping. Bug reports, printer presets, ideas and pull requests are all welcome.

## Reporting a problem

Please include:

- what you did and what you expected
- your printer preset and slicer
- the STL if you can share it (or a smaller one that shows the same problem)
- your browser and OS

Geometry bugs are much easier to fix with the file that triggers them.

## Development

```bash
npm install
npm run dev     # http://localhost:5173, hot reload
npm test        # geometry tests in Node
npm run build   # type-check and build the static site into dist/
```

Code layout and the algorithms are described in [docs/how-it-works.md](docs/how-it-works.md). In short:

- `src/core/` holds pure geometry functions. They run in the Web Worker and in the Node tests, so keep them free of DOM and React.
- `src/worker/` is the worker and its typed RPC (`protocol.ts`). New heavy operations go here so the UI stays responsive.
- `src/App.tsx` is the side panel and state; `src/Viewer.tsx` is the 3D scene.

Before opening a pull request, run `npm test` and `npm run build`. Add a test in `test/` for geometry changes.

### Adding a printer

Add an entry to `PRINTERS` in `src/core/printers.ts` with the build volume from the manufacturer's spec sheet and the slicer it usually ships with.

## Docs and visuals

The images in `docs/images/` are generated, so they can be refreshed when the UI changes.

```bash
npm run demo:model          # demo/rook.stl, the model in every screenshot
npm run dev                 # keep this running
npm run docs:screenshots    # docs/images/screenshots/*.png and docs/images/demo.gif
npm run docs:visuals        # docs/images/{hero,pipeline,autosplit,connectors}.png
```

- `scripts/make-demo.ts` builds the demo chess rook with manifold-3d.
- `scripts/docs/screenshots.mjs` drives the app in headless Chrome. It needs Google Chrome installed (or `CHROME_PATH` pointing at a Chromium build) and `ffmpeg` on your `PATH`. Set `BASE_URL` if the dev server isn't on port 5173.
- `docs/src/*.html` are the diagram sources. `scripts/docs/render.mjs` screenshots each page's `#frame` at 2x. The hero reuses the app screenshots, so run `docs:screenshots` first. `docs/src/rook-profile.js` holds the rook's cross-section profile for the auto-split chart; `npm run docs:visuals` regenerates it with `scripts/docs/profile.ts`.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
