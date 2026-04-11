# Grind Feature Map

This folder owns the `/job` Grind category pieces.

## Files

- `ui.js` builds the Grind screen, fatigue display, cooldown line, and job select menu.
- `handlers.js` handles Grind job selections and starts the matching mini-job.
- `../../utils/grindFatigue.js` controls fatigue and lockout rules.
- `../../data/work/categories/grind/*` contains the actual Grind mini-jobs.

## Easy Edits

- To change the Grind page wording or menu, edit `features/grind/ui.js`.
- To change which mini-job starts for a Grind selection, edit `features/grind/handlers.js`.
- To change fatigue rules, edit `utils/grindFatigue.js`.
- To change a specific mini-job, edit its file in `data/work/categories/grind`.

## Rule Of Thumb

If it is the Grind menu or fatigue display, it probably belongs in `features/grind/ui.js`.
If it is the result of choosing a Grind job, it probably belongs in `features/grind/handlers.js`.
If it is a playable mini-job, it belongs in `data/work/categories/grind`.
