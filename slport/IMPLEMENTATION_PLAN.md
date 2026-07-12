# Second Life Integration Implementation Plan

This is the execution version of `../second_life_integration_plan.md`.

## Phase 1: Server bridge

- Add `POST /api/sl/register`
- Track `cabinetId -> callbackUrl`
- Add a webhook sender for match-complete events
- Add TTL / cleanup for stale cabinet registrations

## Phase 2: Frontend SL mode

- Detect `?mode=sl&cabinetId=...`
- Hide lobby UI that is not useful in-world
- Set a default SL-friendly display name
- Keep the screen focused on the game surface

## Phase 3: LSL controller

- Request a secure URL from Second Life
- Register that URL with the Node server
- Mount MOAP on the cabinet face
- Receive webhook events and trigger in-world rewards

## Phase 4: Verification

- Confirm the browser loads the correct cabinet URL
- Confirm the server stores the callback URL
- Confirm webhook delivery reaches the prim
- Confirm reward behavior is safe and non-duplicating

## Open questions

- Which cabinet object naming convention should be canonical?
- Should callback URLs be refreshed on a timer or only on rezzing?
- Should reward delivery be done by the cabinet or delegated to a HUD?

