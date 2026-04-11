# Night Walker Feature Map

This folder owns the `/job` Night Walker category pieces.

## Files

- `ui.js` builds the Night Walker hub, round screens, and choice buttons.
- `handlers.js` handles Night Walker job selection, round choices, fail states, payouts, and return-to-menu flow.
- `../../data/work/categories/nightwalker/*` contains the Night Walker job data and scenarios.

## Easy Edits

- To change the Night Walker menu, round text layout, or choice buttons, edit `features/nightWalker/ui.js`.
- To change what happens after a choice is pressed, edit `features/nightWalker/handlers.js`.
- To change scenarios, choices, payouts, risk, penalties, or rounds, edit `data/work/categories/nightwalker/*`.

## Rule Of Thumb

If it is the menu or Discord display, it probably belongs in `features/nightWalker/ui.js`.
If it is the result of picking a Night Walker job or choice, it probably belongs in `features/nightWalker/handlers.js`.
If it is story/scenario data, it belongs in `data/work/categories/nightwalker`.
