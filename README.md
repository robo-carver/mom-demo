# mom-demo

A small project I put together to show my mom what I've been working on.

It's a retirement scenario page for her: what she can spend each month if she
keeps the condo, sells it, or moves into it, under cautious or hopeful markets.
Every number she types stays in the phone's browser storage. The public page
runs on made-up demo figures.

## Running it

It's a static page. Open `index.html` through any web server, or the GitHub
Pages copy. To run the model tests:

```
npm install
npm test
```

## Layout

- `src/tax.js` federal and Illinois tax rules, 2026 single filer
- `src/model.js` year-by-year projection and the sustainable spend solver
- `src/ui.js` and `src/chart.js` the page
- `src/defaults.js` demo numbers
