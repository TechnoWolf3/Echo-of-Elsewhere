# Farming Feature Map

This folder is the new home for farming-specific command pieces.

## Files

- `ui.js` builds the farming screens, buttons, select menus, field views, farm market view, and machine shed pages.
- `handlers.js` handles farming button/select-menu clicks such as buying fields, planting, harvesting, selling crops, and buying/renting/selling machines.
- `../../utils/farming/engine.js` controls farming rules such as fields, crops, planting, cultivating, harvesting, and task timers.
- `../../utils/farming/machineEngine.js` controls machinery rules such as owned machines, rentals, sales, and busy machines.
- `../../data/farming/config.js` is where the crops, machines, prices, field limits, and farming tuning live.

## Easy Edits

- To change crop prices, growth time, crop names, seasons, or machine prices, edit `data/farming/config.js`.
- To change what the farming pages say or which buttons appear, edit `features/farming/ui.js`.
- To change what happens when someone presses a farming button, edit `features/farming/handlers.js`.
- To change how farming math works, edit `utils/farming/engine.js`.
- To change how machine buying, renting, selling, or task reservations work, edit `utils/farming/machineEngine.js`.

## Rule Of Thumb

If it is text, embeds, buttons, or select menus, it probably belongs in `features/farming/ui.js`.
If it is the result of pressing one of those buttons or select menus, it probably belongs in `features/farming/handlers.js`.
If it changes saved data or game rules, it probably belongs in one of the `utils/farming` engine files.
