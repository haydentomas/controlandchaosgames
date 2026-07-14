# Second Life Port Workspace

This folder is the working area for the Second Life integration.

The current repo already has a draft integration plan in `../second_life_integration_plan.md`, plus older Second Life-oriented code in `../games/fourinarow/`.

## What belongs here

- backend bridge code for cabinet registration and webhook delivery
- LSL controller scripts for rezzed cabinets
- frontend notes for MOAP / `?mode=sl` behavior
- implementation checklists and testing notes
- the minimal in-world board loader lives at `lsl/control-chaos-board.lsl`

## Suggested first milestones

1. Add a reusable server-side SL bridge module.
2. Add a stable LSL controller template.
3. Add a frontend SL-mode toggle and layout suppression.
4. Wire the bridge into the main Express server.
5. Validate the flow in-world with one cabinet.

## Important constraints

- Keep cabinet state isolated by `cabinetId`.
- Treat the callback URL as ephemeral and re-register after resets.
- Do not assume SL-specific LSL behavior without testing in-world.
