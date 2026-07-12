# Second Life Port Worklog

## Current state

- Root `slport/` workspace created.
- Server bridge scaffold added under `slport/backend/`.
- LSL cabinet template added under `slport/lsl/`.
- Main server already wired once for the SL bridge, but the preferred rule from here is to avoid touching core terminal files unless strictly necessary.
- The cabinet script now points directly at the live server:
  - `https://play.controlandchaos.co.uk`

## Current goal

Get one Second Life cabinet to load the board page inside MOAP with the smallest possible change set.

## What to do next

1. Open `slport/lsl/control-chaos-cabinet.lsl`.
2. Set `CABINET_ID` to the cabinet's stable identifier.
3. Confirm `MOAP_FACE` matches the face that should display the screen.
4. Paste the script into one test prim in Second Life.
5. Reset the script and confirm the board loads.

## What success looks like

- The prim gets a secure callback URL.
- The board page loads on the prim face.
- The page URL includes `?mode=sl&cabinetId=...`.
- You can visually confirm the board is present before doing any gameplay or webhook work.

## Notes

- Keep new work inside `slport/` unless a core terminal change is absolutely required.
- Treat the LSL as a scaffold until it is verified in-world.
- If the board does not appear, check URL, face index, and prim media permissions first.

