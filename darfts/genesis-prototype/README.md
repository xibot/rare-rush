# Genesis in Motion — unpublished draft

Archived source for the former `/genesis-lab/` animation showcase. Retained for future design work; this is not a public page.

The production build has no entry point, HTML copy, or route for this directory, and `.vercelignore` excludes `darfts/` from deployment uploads. The old showcase output is removed when rebuilding an existing output directory. Public links to the page have been removed.

The live Genesis game still uses `games/rare-rush/genesis/GenesisRunnerSprite.tsx` and its 36-body pool. This draft imports that shared renderer but is not needed for gameplay. Its sample portrait is the public Genesis #1 artwork.

To revisit the design, bundle `index.tsx` locally and serve the result alongside `index.html`; do not add it back to the public build or navigation without approval. The previous browser checks and publishing configuration remain available in Git history at commit `f4b8f2e`.
