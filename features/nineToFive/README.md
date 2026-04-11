# 9-to-5 Feature Map

This folder owns the `/job` Work a 9-5 category pieces.

## Files

- `ui.js` builds the 9-to-5 hub, contract screens, skill check screen, shift screen, trucker manifest, and trucker progress screens.
- `handlers.js` handles 9-to-5 selections, contracts, skill checks, shifts, trucker jobs, and legendary jobs.
- `../../data/work/categories/nineToFive/*` contains the tuning/config for the 9-to-5 jobs.

## Easy Edits

- To change the 9-to-5 menu, contract pages, skill screen, shift screen, or trucker screens, edit `features/nineToFive/ui.js`.
- To change what happens when a 9-to-5 button is pressed, edit `features/nineToFive/handlers.js`.
- To change payout ranges, XP, trucker routes, freight, shift duration, or skill emojis, edit `data/work/categories/nineToFive/*`.

## Rule Of Thumb

If it is text, embeds, buttons, select menus, or progress displays, it probably belongs in `features/nineToFive/ui.js`.
If it is the result of pressing a 9-to-5 button, it probably belongs in `features/nineToFive/handlers.js`.
If it is job tuning, it belongs in `data/work/categories/nineToFive`.
