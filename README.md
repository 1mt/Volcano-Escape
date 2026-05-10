# Volcano Escape DX

Volcano Escape DX is a first-person 3D arcade climber about escaping a tropical island volcano by jumping between rocks, springs, drifting platforms, crumble ledges, and boost pads.

## How to Play

- Move with `WASD`.
- Look with the mouse after pressing Play.
- Jump with `Space`.
- Hold `Shift` to spend dash boost.
- Press `P` or `Esc` to pause.
- Touch controls appear on mobile devices.

## What Changed

This version replaces the original random-rock prototype with a cleaner first-person 3D game loop:

- Clear separation between input, simulation, rendering, audio, and UI.
- Deterministic route generation so the main climb stays jumpable.
- Procedural tropical volcano scenery with island, ocean, palms, clouds, lava glow, and sky gate.
- Multiple platform types, collectibles, dash management, win and loss states.
- Responsive full-screen WebGL presentation with a bright retro 3D platformer feel.
- No external runtime dependencies; the game can be served as a static site.

## Run Locally

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).
