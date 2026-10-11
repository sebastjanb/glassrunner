# Glass Runner

Three-lane endless runner for Meta Ray-Ban Display glasses. One static page, no server, no account. Own artwork.

| Input | Action |
| --- | --- |
| Left / Right | change lane |
| Up | jump over low barriers (yellow) |
| Down | slide under high bars (purple); also cuts a jump short |
| Pinch | start, pause, continue |
| Back | leave the app |

Trains (red) fill a lane: go around them. At least one lane is always free of trains, and rows are spaced by speed so
there is time to react. Speed rises slowly. Score is distance plus ten per coin; the best score stays on the glasses.
The game pauses when the app is hidden.

Publish: push to `main`; GitHub Pages serves `site/`. On the glasses add `https://<user>.github.io/glassrunner/index.html`.
Bump `CACHE` in `site/sw.js` with every release. Icons: `python3 make-icons.py runner site 79,227,255`.
