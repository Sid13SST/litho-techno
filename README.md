# Litho Techno: Tuned Mass Damper Lab

Real-time structural dynamics in the browser: two identical 20-story towers face the same earthquake, and one has a tuned mass damper (TMD) in its crown.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/ (deploys as-is to Vercel / Netlify)
```

## Pages

| Tab | What it does |
| --- | --- |
| **Simulation Lab** | 3D side-by-side towers, three earthquake scenarios, magnitude 4.5–8.0, live TMD tuning, roof-drift chart, performance table, and a floor-by-floor monitor with drift, damage state, structural health, stability margin and P-Δ index for every floor |
| **Hardware Bench** | Arduino Uno R3 + 2× MPU-6050 over Web Serial (Chrome/Edge), tare, test recording per magnitude, results history. Includes a physics-based virtual shake table when no board is connected |
| **How It Works** | Exact frequency-response curves, Warburton optimal-tuning formulas, model description, real-world TMDs |

## Physics

- Lumped-mass shear building (20 DOF), closed-form stiffness for target f₁, stiffness-proportional damping
- Pendulum TMD as an extra DOF with an elastomer bumper ring at the stroke limit, so the mass can't leave its chamber
- RK4 at 480 Hz; both towers share one ground record
- Ground motion: Clough–Penzien filtered noise with envelope, resonance sine, near-fault pulse; seeded and repeatable
- Damage: inter-story drift → HAZUS-style damage states; stability via drift margin to 2.5 % and ASCE 7 P-Δ coefficient θ

## Hardware

Serial format: one line per sample, `a1,a2` (g) at 115200 baud. JSON (`{"b1":..,"b2":..}`), single values and raw MPU counts are also accepted. The sketch is in the Hardware Bench tab (copy / download `.ino`).

Keyboard: `Space` play/pause, `R` restart.
