# Farming Feature Map

This folder is the new home for farming-specific command pieces.

## Files

- `ui.js` builds the farming screens, buttons, select menus, field views, farm market view, and machine shed pages.
- `handlers.js` handles farming button/select-menu clicks such as buying fields, planting, harvesting, selling crops, and buying/renting/selling machines.
- `../../utils/farming/engine.js` controls farming rules such as fields, crops, planting, cultivating, harvesting, and task timers.
- `../../utils/farming/machineEngine.js` controls machinery rules such as owned machines, rentals, sales, and busy machines.
- `../../data/farming/config.js` stores field limits and general farming tuning.
- `../../data/farming/crops.js`, `machines.js`, `fertilisers.js`, `animalHusbandry.js`, `livestock.js`, `weather.js`, and `marketConfig.js` store the farming content/tuning tables.

## Easy Edits

- To change field limits or base farming costs, edit `data/farming/config.js`.
- To change crop growth, crop names, seasons, or yields, edit `data/farming/crops.js`.
- To change produce market prices, edit `data/farming/marketConfig.js`.
- To change fertiliser prices/effects, edit `data/farming/fertilisers.js`.
- To change animal breeding prices, offspring counts, or maturity timers, edit `data/farming/animalHusbandry.js`.
- To change machine buy/rent prices or speed multipliers, edit `data/farming/machines.js`.
- To change what the farming pages say or which buttons appear, edit `features/farming/ui.js`.
- To change what happens when someone presses a farming button, edit `features/farming/handlers.js`.
- To change how farming math works, edit `utils/farming/engine.js`.
- To change how machine buying, renting, selling, or task reservations work, edit `utils/farming/machineEngine.js`.

## Fertiliser Notes

- The farming Store is a category hub like the Machine Shed; fertiliser is currently one store category.
- Fertiliser stock is saved on the farm JSON under `farm.fertilisers`.
- Fertiliser purchases use a select-to-modal flow so players can enter a quantity instead of buying one at a time.
- A crop can be fertilised during the first 10% of its current growth cycle and again after 75% growth, before it becomes ready.
- Regrowing crops reset fertiliser stages after each harvest, so the next regrow cycle can be fertilised again.
- If a field is in a fertiliser window and the player owns fertiliser, the field page shows an apply dropdown. If they own none, it should show a `Buy Fertiliser` route.
- Machine speed multipliers apply to field task durations through the best compatible owned/rented machine set.

## Barn And Husbandry Notes

- Converting a field into a barn now creates a level 1 barn, even if the field had been upgraded.
- Demolishing a barn back into a field also resets the resulting field to level 1.
- Barn upgrades are timed tasks. Animals can stay inside, but production is paused until the upgrade completes.
- Barn capacity scales with barn level. More adult animals means more produce; young animals count toward capacity but do not produce.
- Animal husbandry items live in the Farm Store and are bought through a select-to-modal flow like fertiliser.
- Breeding requires a matching husbandry item, at least two adult animals, and enough free barn capacity for the young animals.
- Young animals mature automatically during farming rollovers and when barn views/production calculations are touched.

## Rule Of Thumb

If it is text, embeds, buttons, or select menus, it probably belongs in `features/farming/ui.js`.
If it is the result of pressing one of those buttons or select menus, it probably belongs in `features/farming/handlers.js`.
If it changes saved data or game rules, it probably belongs in one of the `utils/farming` engine files.
