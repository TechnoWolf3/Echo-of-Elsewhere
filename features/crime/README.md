# Crime Feature Map

This folder owns the `/job` crime category pieces.

## Files

- `ui.js` builds the Crime screen, heat display, cooldown lines, and job select menu.
- `handlers.js` handles Crime job clicks such as Store Robbery, Scam Call, Heist, Major Heist, and placeholders.
- `constants.js` keeps Crime cooldown keys and heist heat timing in one place.
- `../../utils/crimeHeat.js` controls stored heat values and heat expiry.
- `../../utils/jail.js` controls jail status. Jail still blocks every job category from `/job`.
- `../../data/work/categories/crime/*` contains the actual crime minigames.

## Easy Edits

- To change crime page wording or the job menu, edit `features/crime/ui.js`.
- To change what happens when someone starts a crime job, edit `features/crime/handlers.js`.
- To change crime cooldown keys or heist heat expiry timings, edit `features/crime/constants.js`.
- To change the Store Robbery, Scam Call, or Heist minigames, edit `data/work/categories/crime/*`.

## Rule Of Thumb

If it is the Crime menu, heat display, or buttons/select menus, it probably belongs in `features/crime/ui.js`.
If it is the result of choosing a Crime job, it probably belongs in `features/crime/handlers.js`.
If it is reusable heat or jail storage logic, it belongs in `utils`.
