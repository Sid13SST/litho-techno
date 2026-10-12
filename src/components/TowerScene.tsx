import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DAMAGE_STATES, damageState, type SeismicEngine } from '../sim/engine'

/* ---------------- scene geometry (world units ≈ metres) ---------------- */
const W = 14 // tower width (x)
const D = 14 // tower depth (z)
const SPACING = 21 // tower x offset from centre
const CROWN = 3 // top stories rendered as a glass TMD chamber
const COL = 0.7 // column size
const VIS_LIMIT = 9 // soft cap on exaggerated sway

// TMD geometry (in the roof frame)
const CABLE = 5.6
const BALL_R = 2.0
const RING_R = 5.4 // bumper ring radius: the ball edge touches it exactly at the stroke limit
const FREE_OFF = RING_R - BALL_R // visual offset at the stroke limit
const SQUASH = 0.25 // max visual compression of the rubber ring beyond the limit

export type ViewMode = 'front' | 'tmd' | 'orbit'
export type ColorMode = 'live' | 'damage'
const DS_COLORS = DAMAGE_STATES.map((d) => new THREE.Color(d.color))

const BARE = new THREE.Color('#fb7185')
const TMD = new THREE.Color('#38bdf8')
const REST = new THREE.Color('#3b4a63')
const OK = new THREE.Color('#34d399')
const WARN = new THREE.Color('#fbbf24')
const BAD = new THREE.Color('#f43f5e')

function driftColor(idr: number, out: THREE.Color) {
  // rest → 0.2 % green → 0.8 % amber → 1.8 % red
  if (idr < 0.002) return out.copy(REST).lerp(OK, idr / 0.002)
  if (idr < 0.008) return out.copy(OK).lerp(WARN, (idr - 0.002) / 0.006)
  return out.copy(WARN).lerp(BAD, Math.min(1, (idr - 0.008) / 0.01))
}

function makeFacadeTexture() {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#0c1424'
  g.fillRect(0, 0, 512, 64)
  const cols = 14
  const cw = 512 / cols
  let s = 11
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < cols; i++) {
    const r = rnd()
    g.fillStyle = r > 0.62 ? `rgba(255, 214, 150, ${0.55 + rnd() * 0.4})` : r > 0.4 ? `rgba(150, 200, 255, ${0.25 + rnd() * 0.3})` : 'rgba(40, 60, 90, .9)'
    g.fillRect(i * cw + 4, 12, cw - 8, 40)
  }
  g.fillStyle = 'rgba(148,163,184,.25)'
  g.fillRect(0, 0, 512, 3)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const UP = new THREE.Vector3(0, 1, 0)
const tmpV = new THREE.Vector3()
/** stretch a unit-height cylinder between two points */
function span(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  tmpV.subVectors(b, a)
  const len = Math.max(tmpV.length(), 1e-4)
  mesh.position.copy(a).addScaledVector(tmpV, 0.5)
  mesh.scale.set(1, len, 1)
  mesh.quaternion.setFromUnitVectors(UP, tmpV.divideScalar(len))
}

/* ---------------------------------------------------------------------- */

interface TowerProps {
  engine: SeismicEngine
  kind: 'bare' | 'tmd'
  exaggeration: React.MutableRefObject<number>
  colorMode: React.MutableRefObject<ColorMode>
  facade: THREE.Texture
}

function Tower({ engine, kind, exaggeration, colorMode, facade }: TowerProps) {
  const n = engine.p.stories
  const h = engine.p.storyHeight
  const xBase = kind === 'bare' ? -SPACING : SPACING
  const accent = kind === 'bare' ? BARE : TMD

  const storyRefs = useRef<(THREE.Group | null)[]>([])
  const slabRefs = useRef<(THREE.Object3D | null)[]>([])
  const roofRef = useRef<THREE.Group>(null)
  const xs = useMemo(() => new Float64Array(n + 1), [n])
  const col = useMemo(() => new THREE.Color(), [])

  const mats = useMemo(() => {
    const facadeMat = new THREE.MeshStandardMaterial({ map: facade, emissiveMap: facade, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.2 })
    const glass = new THREE.MeshPhysicalMaterial({ color: accent.clone().lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })
    const steel = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.4, metalness: 0.7 })
    const accentMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4, roughness: 0.4 })
    const slabs = Array.from({ length: n }, () => new THREE.MeshStandardMaterial({ color: '#1e293b', emissive: REST.clone(), emissiveIntensity: 1.1, roughness: 0.6 }))
    return { facadeMat, glass, steel, accentMat, slabs }
  }, [n, facade, accent])

  useEffect(() => () => {
    mats.facadeMat.dispose(); mats.glass.dispose(); mats.steel.dispose(); mats.accentMat.dispose(); mats.slabs.forEach((m) => m.dispose())
  }, [mats])

  useFrame(() => {
    const ch = kind === 'bare' ? engine.bare : engine.tmd
    const metrics = kind === 'bare' ? engine.mBare : engine.mTmd
    const E = exaggeration.current
    const gd = engine.groundDispAt(engine.t)
    xs[0] = gd
    for (let j = 0; j < n; j++) xs[j + 1] = gd + VIS_LIMIT * Math.tanh((E * ch.x[j]) / VIS_LIMIT)
    for (let j = 0; j < n; j++) {
      const g = storyRefs.current[j]
      if (g) {
        const s = (xs[j + 1] - xs[j]) / h
        g.matrix.set(1, s, 0, xs[j] + (xs[j + 1] - xs[j]) / 2, 0, 1, 0, (j + 0.5) * h, 0, 0, 1, 0, 0, 0, 0, 1)
        g.matrixWorldNeedsUpdate = true
      }
      const slab = slabRefs.current[j]
      if (slab) {
        slab.position.x = xs[j + 1]
        const idr = Math.abs(ch.x[j] - (j > 0 ? ch.x[j - 1] : 0)) / h
        if (colorMode.current === 'damage') col.copy(metrics.samples ? DS_COLORS[damageState(metrics.storyPeakIdr[j])] : REST)
        else driftColor(idr, col)
        mats.slabs[j].emissive.copy(col)
      }
    }
    if (roofRef.current) roofRef.current.position.x = xs[n]
  })

  return (
    <group position={[xBase, 0, 0]}>
      {Array.from({ length: n }, (_, j) => {
        const crown = kind === 'tmd' && j >= n - CROWN
        return (
          <group key={j} ref={(el) => { storyRefs.current[j] = el }} matrixAutoUpdate={false}>
            {crown ? (
              <mesh material={mats.glass} renderOrder={2}>
                <boxGeometry args={[W, h, D]} />
              </mesh>
            ) : (
              <mesh material={mats.facadeMat} castShadow receiveShadow>
                <boxGeometry args={[W - 0.2, h, D - 0.2]} />
              </mesh>
            )}
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
              <mesh key={i} material={mats.steel} position={[(sx * (W - COL)) / 2, 0, (sz * (D - COL)) / 2]} castShadow>
                <boxGeometry args={[COL, h, COL]} />
              </mesh>
            ))}
            {crown && [[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([sx, sz], i) => [1, -1].map((dir) => (
              // X-bracing on the crown walls (offset slightly so the two diagonals don't z-fight)
              <mesh
                key={`b${i}${dir}`}
                material={mats.steel}
                position={[(sx * (W - 0.3)) / 2 + (sx ? 0 : dir * 0.04), 0, (sz * (D - 0.3)) / 2 + (sx ? dir * 0.04 : 0)]}
                rotation={sx ? [Math.atan2(W, h) * dir, 0, 0] : [0, 0, Math.atan2(W, h) * dir]}
              >
                <boxGeometry args={[0.16, Math.hypot(W, h) * 0.98, 0.16]} />
              </mesh>
            )))}
          </group>
        )
      })}
      {Array.from({ length: n }, (_, j) => {
        // floors inside the crown are open ring-beams so the damper chamber is a clear double-height space
        const open = kind === 'tmd' && j >= n - CROWN && j < n - 1
        return open ? (
          <group key={`s${j}`} ref={(el) => { slabRefs.current[j] = el }} position={[0, (j + 1) * h, 0]}>
            {[[0, (D + 0.5) / 2 - 0.4, W + 0.5, 0.8], [0, -(D + 0.5) / 2 + 0.4, W + 0.5, 0.8], [(W + 0.5) / 2 - 0.4, 0, 0.8, D + 0.5], [-(W + 0.5) / 2 + 0.4, 0, 0.8, D + 0.5]].map(([x, z, w, d], i) => (
              <mesh key={i} material={mats.slabs[j]} position={[x, 0, z]}>
                <boxGeometry args={[w, 0.32, d]} />
              </mesh>
            ))}
          </group>
        ) : (
          <mesh key={`s${j}`} ref={(el) => { slabRefs.current[j] = el }} material={mats.slabs[j]} position={[0, (j + 1) * h, 0]} receiveShadow>
            <boxGeometry args={[W + 0.5, 0.32, D + 0.5]} />
          </mesh>
        )
      })}
      <group ref={roofRef} position={[0, n * h, 0]}>
        <mesh material={mats.steel} position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[W - 3, 1.2, D - 3]} />
        </mesh>
        <mesh material={mats.steel} position={[0, 4, 0]}>
          <cylinderGeometry args={[0.18, 0.35, 6, 8]} />
        </mesh>
        <mesh material={mats.accentMat} position={[0, 7.3, 0]}>
          <sphereGeometry args={[0.45, 16, 16]} />
        </mesh>
        {kind === 'tmd' && <Damper engine={engine} storyHeight={h} />}
      </group>
    </group>
  )
}

/* ---------------- tuned mass damper assembly (roof frame) ---------------- */

function Damper({ engine, storyHeight }: { engine: SeismicEngine; storyHeight: number }) {
  const root = useRef<THREE.Group>(null)
  const ball = useRef<THREE.Group>(null)
  const ring = useRef<THREE.MeshStandardMaterial>(null)
  const cables = useRef<(THREE.Mesh | null)[]>([])
  const housings = useRef<(THREE.Mesh | null)[]>([])
  const rods = useRef<(THREE.Mesh | null)[]>([])
  const ends = useRef<(THREE.Mesh | null)[]>([])

  const topY = -0.5
  const floorY = -CROWN * storyHeight + 0.25
  const restY = topY - CABLE - BALL_R * 0.55
  const ringY = restY - 0.2

  const cableTop = useMemo(() => [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].map(([x, z]) => new THREE.Vector3(x, topY, z)), [topY])
  const dampDirs = useMemo(() => [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]], [])
  const anchors = useMemo(() => dampDirs.map(([x, z]) => new THREE.Vector3(x * 5.2, floorY, z * 5.2)), [dampDirs, floorY])
  const ballMats = useMemo(() => ({
    gold: new THREE.MeshStandardMaterial({ color: '#f59e0b', metalness: 0.88, roughness: 0.18, emissive: '#78350f', emissiveIntensity: 0.45 }),
    steel: new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.9, roughness: 0.25 }),
  }), [])
  useEffect(() => () => { ballMats.gold.dispose(); ballMats.steel.dispose() }, [ballMats])

  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  const c = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const visible = engine.p.tmdEnabled
    if (root.current) root.current.visible = visible
    if (!visible || !ball.current) return
    const s = engine.strokeNow()
    const u = s / engine.p.stroke
    // linear inside the stroke; beyond it the ball can only squash the ring a little
    const dx = Math.abs(u) <= 1 ? u * FREE_OFF : Math.sign(u) * (FREE_OFF + SQUASH * Math.tanh((Math.abs(u) - 1) * 4))
    const lift = CABLE - Math.sqrt(CABLE * CABLE - dx * dx * 0.5) // pendulum rises as it swings
    const cy = restY + lift
    ball.current.position.set(dx, cy, 0)
    const rz = Math.atan2(dx, CABLE) * 0.6
    ball.current.rotation.z = rz
    const cz = Math.cos(rz), sz = Math.sin(rz)
    // ball-local point → roof frame (the ball tilts slightly as it swings)
    const onBall = (out: THREE.Vector3, lx: number, ly: number, lz: number) => out.set(dx + cz * lx - sz * ly, cy + sz * lx + cz * ly, lz)

    for (let i = 0; i < 4; i++) {
      const m = cables.current[i]
      if (!m) continue
      const t = cableTop[i]
      onBall(b, t.x * 0.4, BALL_R + 0.3, t.z * 0.4) // shackle ring on top
      span(m, t, b)
    }
    for (let i = 0; i < anchors.length; i++) {
      const [ux, uz] = dampDirs[i]
      a.copy(anchors[i])
      onBall(b, ux * BALL_R * 0.72, -BALL_R * 0.7, uz * BALL_R * 0.72) // attachment lug on the bottom collar
      c.subVectors(b, a)
      const len = c.length()
      const housingLen = Math.min(2.3, len * 0.62)
      c.normalize()
      const hEnd = tmpV.copy(a).addScaledVector(c, housingLen).clone()
      const hm = housings.current[i]; if (hm) span(hm, a, hEnd)
      const rm = rods.current[i]; if (rm) span(rm, hEnd.addScaledVector(c, -0.3), b)
      const em = ends.current[i]; if (em) em.position.copy(b)
    }
    if (ring.current) {
      const hit = Math.abs(s) > engine.p.stroke
      ring.current.emissiveIntensity = hit ? 2.4 : 0.35
      ring.current.emissive.set(hit ? '#f43f5e' : '#38bdf8')
    }
  })

  return (
    <group ref={root}>
      {/* support frame under the roof */}
      <mesh position={[0, topY + 0.2, 0]}>
        <boxGeometry args={[5, 0.4, 5]} />
        <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* chamber floor */}
      <mesh position={[0, floorY - 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[6.2, 6.2, 0.2, 48]} />
        <meshStandardMaterial color="#0f1a2c" metalness={0.4} roughness={0.7} />
      </mesh>
      {/* bumper ring */}
      <mesh position={[0, ringY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R + 0.18, 0.22, 12, 72]} />
        <meshStandardMaterial ref={ring} color="#1e293b" emissive="#38bdf8" emissiveIntensity={0.35} metalness={0.6} roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={`rp${i}`} position={[Math.cos((i * Math.PI) / 2 + Math.PI / 8) * (RING_R + 0.18), (ringY + floorY) / 2, Math.sin((i * Math.PI) / 2 + Math.PI / 8) * (RING_R + 0.18)]}>
          <cylinderGeometry args={[0.12, 0.12, ringY - floorY, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* cables */}
      {cableTop.map((_, i) => (
        <mesh key={`c${i}`} ref={(el) => { cables.current[i] = el }}>
          <cylinderGeometry args={[0.07, 0.07, 1, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* viscous dampers: housing + piston rod + clevis */}
      {anchors.map((p, i) => (
        <group key={`d${i}`}>
          <mesh position={p}>
            <boxGeometry args={[0.8, 0.3, 0.8]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh ref={(el) => { housings.current[i] = el }} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 1, 14]} />
            <meshStandardMaterial color="#38bdf8" emissive="#0369a1" emissiveIntensity={0.5} metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh ref={(el) => { rods.current[i] = el }}>
            <cylinderGeometry args={[0.11, 0.11, 1, 10]} />
            <meshStandardMaterial color="#e2e8f0" metalness={1} roughness={0.15} />
          </mesh>
          <mesh ref={(el) => { ends.current[i] = el }}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* the mass */}
      <group ref={ball}>
        <mesh material={ballMats.gold} castShadow>
          <sphereGeometry args={[BALL_R, 64, 48]} />
        </mesh>
        {/* equator reinforcement belt */}
        <mesh material={ballMats.steel} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[BALL_R + 0.02, 0.09, 12, 64]} />
        </mesh>
        {/* top shackle plate + ring */}
        <mesh material={ballMats.steel} position={[0, BALL_R + 0.05, 0]}>
          <cylinderGeometry args={[0.75, 0.9, 0.2, 32]} />
        </mesh>
        <mesh material={ballMats.steel} position={[0, BALL_R + 0.3, 0]}>
          <torusGeometry args={[0.55, 0.08, 10, 32]} />
        </mesh>
        {/* bottom collar where the dampers attach */}
        <mesh material={ballMats.steel} position={[0, -BALL_R * 0.7, 0]}>
          <cylinderGeometry args={[BALL_R * 0.78, BALL_R * 0.62, 0.3, 40]} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------------- ground, seismic rings, camera ---------------- */

function Ground({ engine }: { engine: SeismicEngine }) {
  const shake = useRef<THREE.Group>(null)
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const life = useRef(new Float32Array(6).fill(1))
  const spawnAcc = useRef(0)
  useFrame((_, dt) => {
    const gd = engine.groundDispAt(engine.t)
    if (shake.current) shake.current.position.x = gd
    const ag = Math.abs(engine.agAt(engine.t)) / 9.81
    if (engine.playing) spawnAcc.current += dt * Math.min(3, ag / Math.max(engine.rec.pga, 1e-3)) * 2.2
    for (let i = 0; i < 6; i++) {
      const m = rings.current[i]
      if (!m) continue
      if (spawnAcc.current >= 1 && life.current[i] >= 1) { life.current[i] = 0; spawnAcc.current = 0 }
      if (life.current[i] < 1) life.current[i] = Math.min(1, life.current[i] + dt / 3.2)
      const l = life.current[i]
      m.visible = l < 1
      m.scale.setScalar(4 + l * 110)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - l) * 0.35
    }
  })
  return (
    <>
      <group ref={shake}>
        {[-SPACING, SPACING].map((x, i) => (
          <mesh key={i} position={[x, -0.6, 0]} receiveShadow castShadow>
            <boxGeometry args={[W + 6, 1.2, D + 6]} />
            <meshStandardMaterial color="#1b2537" metalness={0.3} roughness={0.8} />
          </mesh>
        ))}
        <Grid position={[0, -1.19, 0]} args={[300, 300]} cellSize={4} cellThickness={0.6} cellColor="#1c2a44" sectionSize={20} sectionThickness={1} sectionColor="#24426b" fadeDistance={260} fadeStrength={1.4} infiniteGrid />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.25, 0]} receiveShadow>
        <circleGeometry args={[400, 64]} />
        <meshStandardMaterial color="#060a13" roughness={1} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} ref={(el) => { rings.current[i] = el }} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, -30]} visible={false}>
          <ringGeometry args={[0.97, 1, 96]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </>
  )
}

const VIEWS: Record<ViewMode, { pos: [number, number, number]; target: [number, number, number] }> = {
  front: { pos: [0, 44, 140], target: [0, 37, 0] },
  tmd: { pos: [SPACING + 20, 74, 34], target: [SPACING, 64, 0] },
  orbit: { pos: [-90, 70, 125], target: [0, 36, 0] },
}

// panning is limited to a box around the towers so the scene can't be lost off-screen
const PAN_MIN = new THREE.Vector3(-70, 0, -60)
const PAN_MAX = new THREE.Vector3(70, 95, 60)

function CameraRig({ view, controls, resetKey, userControl }: { view: ViewMode; controls: React.RefObject<OrbitControlsImpl>; resetKey: number; userControl: React.MutableRefObject<boolean> }) {
  const { camera, size } = useThree()
  const anim = useRef(1)
  useEffect(() => { anim.current = 0; userControl.current = false }, [view, resetKey, userControl])
  const targetPos = useMemo(() => new THREE.Vector3(), [])
  const targetLook = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const ctl = controls.current
    if (!ctl) return
    ctl.autoRotate = view === 'orbit' && !userControl.current
    ctl.autoRotateSpeed = 0.6
    ctl.target.clamp(PAN_MIN, PAN_MAX)
    if (userControl.current) anim.current = 1 // the user grabbed the camera: stop any fly-to animation
    if (anim.current >= 1) return
    anim.current = Math.min(1, anim.current + dt * 1.4)
    const v = VIEWS[view]
    const narrow = size.width < 640 && view !== 'tmd' ? 1.45 : 1
    targetPos.set(v.pos[0] * narrow, v.pos[1], v.pos[2] * narrow)
    targetLook.set(...v.target)
    const k = 1 - Math.pow(0.001, dt * 1.4)
    camera.position.lerp(targetPos, k)
    ctl.target.lerp(targetLook, k)
    ctl.update()
  })
  return null
}

export interface CameraApi { zoom: (factor: number) => void }

/** Smooth button zoom: eases the camera distance toward a goal, clamped like wheel zoom. */
function CameraApiBridge({ api, controls }: { api?: React.MutableRefObject<CameraApi | null>; controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera } = useThree()
  const goal = useRef<number | null>(null)
  const off = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => {
    if (!api) return
    api.current = {
      zoom: (f) => {
        const ctl = controls.current
        if (!ctl) return
        const d = camera.position.distanceTo(ctl.target)
        goal.current = THREE.MathUtils.clamp((goal.current ?? d) * f, 8, 320)
      },
    }
    return () => { api.current = null }
  }, [api, camera, controls])
  useFrame((_, dt) => {
    const ctl = controls.current
    if (goal.current === null || !ctl) return
    off.subVectors(camera.position, ctl.target)
    const d = off.length()
    const next = THREE.MathUtils.lerp(d, goal.current, 1 - Math.pow(0.0005, dt))
    camera.position.copy(ctl.target).addScaledVector(off.normalize(), next)
    ctl.update()
    if (Math.abs(next - goal.current) < 0.05) goal.current = null
  })
  return null
}

function Stepper({ engine }: { engine: SeismicEngine }) {
  useFrame((_, dt) => engine.advance(dt))
  return null
}

export default function TowerScene(props: {
  engine: SeismicEngine
  exaggeration: React.MutableRefObject<number>
  colorMode: React.MutableRefObject<ColorMode>
  view: ViewMode
  /** bump to fly back to the current preset view */
  resetKey?: number
  onReset?: () => void
  onInteract?: () => void
  cameraApi?: React.MutableRefObject<CameraApi | null>
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const userControl = useRef(false)
  const facade = useMemo(() => makeFacadeTexture(), [])
  const { engine } = props
  return (
    <Canvas
      onDoubleClick={() => props.onReset?.()}
      shadows
      dpr={[1, 2]}
      camera={{ position: VIEWS.front.pos, fov: 38, near: 0.5, far: 1200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        scene.background = new THREE.Color('#070b14')
        scene.fog = new THREE.Fog('#070b14', 160, 420)
      }}
    >
      <Stepper engine={engine} />
      <hemisphereLight args={['#9cc8ff', '#0b1220', 0.7]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[60, 120, 80]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={110}
        shadow-camera-bottom={-10}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-80, 40, -60]} intensity={0.6} color="#7dd3fc" />
      <pointLight position={[SPACING + 4, engine.p.stories * engine.p.storyHeight - 1.5, 9]} intensity={70} distance={26} color="#fde68a" />
      <group>
        <Tower engine={engine} kind="bare" exaggeration={props.exaggeration} colorMode={props.colorMode} facade={facade} />
        <Tower engine={engine} kind="tmd" exaggeration={props.exaggeration} colorMode={props.colorMode} facade={facade} />
      </group>
      <Ground engine={engine} />
      <OrbitControls
        ref={controls}
        target={VIEWS.front.target}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        enableZoom
        zoomSpeed={1.1}
        zoomToCursor
        minDistance={8}
        maxDistance={320}
        enablePan
        panSpeed={0.9}
        screenSpacePanning
        maxPolarAngle={Math.PI / 2 - 0.04}
        onStart={() => { userControl.current = true; props.onInteract?.() }}
      />
      <CameraApiBridge api={props.cameraApi} controls={controls} />
      <CameraRig view={props.view} controls={controls} resetKey={props.resetKey ?? 0} userControl={userControl} />
    </Canvas>
  )
}
