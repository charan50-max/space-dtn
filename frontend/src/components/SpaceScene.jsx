import React, { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  OrbitControls,
  Stars,
  useGLTF,
  Html,
} from "@react-three/drei";
import useArrivals from "./useArrivals";
import "./dtn-callouts.css";
import {
  disruptLink as apiDisruptLink,
  restoreLink as apiRestoreLink,
  resetLinkConditions as apiResetLinkConditions,
} from "../services/api";

/*
 * SPACE DTN — 3D CONSTELLATION
 *
 * Design:
 * - Earth stays compact enough that every orbital plane remains visible.
 * - Each satellite has one fixed orbital plane and moves slowly around it.
 * - The actual satellite.glb is the visible node. No artificial sphere/ring
 *   is drawn around the satellite.
 * - Every link is re-routed each frame so it never passes through the Earth:
 *   satellite-to-satellite beams stay straight while the line of sight is
 *   clear and bend around the planet only as much as needed when it is not.
 * - Satellite-to-ground links are elevated arcs, lifted further when the
 *   satellite is on the far side of the planet.
 * - Packet markers travel along exactly the same curved path as the beams.
 * - Ground stations are separated geographically so they are visually distinct.
 */

const EARTH_RADIUS = 1.65;

/*
 * Seven deliberately separated orbital planes.
 * velocity is intentionally very small so the motion is slow and readable.
 */
const ORBITS = {
  "SAT-1": {
    radius: 3.75,
    inclination: 0.10,
    raan: 0.10,
    phase: 0.20,
    velocity: 0.010,
  },
  "SAT-2": {
    radius: 4.05,
    inclination: 0.42,
    raan: 1.10,
    phase: 1.55,
    velocity: 0.0085,
  },
  "SAT-3": {
    radius: 4.35,
    inclination: -0.34,
    raan: 2.15,
    phase: 2.85,
    velocity: 0.0092,
  },
  "SAT-4": {
    radius: 4.70,
    inclination: 0.62,
    raan: 3.25,
    phase: 4.10,
    velocity: 0.0078,
  },
  "SAT-5": {
    radius: 5.05,
    inclination: -0.55,
    raan: 4.35,
    phase: 5.25,
    velocity: 0.0088,
  },
  "SAT-6": {
    radius: 4.50,
    inclination: 0.28,
    raan: 5.20,
    phase: 0.90,
    velocity: 0.0090,
  },
  "SAT-7": {
    radius: 5.25,
    inclination: -0.20,
    raan: 0.75,
    phase: 3.60,
    velocity: 0.0082,
  },
};

/*
 * Deliberately separated ground stations.
 * GS-1: Mumbai
 * GS-2: Sydney
 *
 * The backend still calls them GS-1 / GS-2, so no backend change is required.
 */
const GROUND_STATIONS = {
  "GS-1": {
    lat: 19.076,
    lon: 72.877,
  },
  "GS-2": {
    lat: -33.8688,
    lon: 151.2093,
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function getOrbitPositionAtAngle(orbit, theta) {
  const position = new THREE.Vector3(
    orbit.radius * Math.cos(theta),
    orbit.radius * Math.sin(theta),
    0
  );

  position.applyAxisAngle(X_AXIS, orbit.inclination);
  position.applyAxisAngle(Z_AXIS, orbit.raan);

  return position;
}

function getOrbitPosition(orbit, time = 0) {
  return getOrbitPositionAtAngle(
    orbit,
    orbit.phase + time * orbit.velocity
  );
}

function getGroundPosition(latitude, longitude) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);

  const radius = EARTH_RADIUS + 0.055;

  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon)
  );
}

function getNodePosition(nodeId, time) {
  if (ORBITS[nodeId]) {
    return getOrbitPosition(ORBITS[nodeId], time);
  }

  if (GROUND_STATIONS[nodeId]) {
    const station = GROUND_STATIONS[nodeId];

    return getGroundPosition(
      station.lat,
      station.lon
    );
  }

  return null;
}

function normalizeLink(link) {
  let status =
    link.status ??
    link.state ??
    "active";

  if (typeof link.active === "boolean") {
    status = link.active
      ? "active"
      : "disrupted";
  }

  return {
    id:
      link.id ??
      `${link.source ?? link.from}-${link.target ?? link.to}`,

    source:
      link.source ??
      link.from ??
      link.node_a ??
      link.nodeA,

    target:
      link.target ??
      link.to ??
      link.node_b ??
      link.nodeB,

    status: String(status).toLowerCase(),
  };
}

function EarthModel() {
  const { scene } = useGLTF(
    "/models/earth.glb"
  );

  const earth = useMemo(() => {
    const cloned = cloneSkinned(scene);

    const box =
      new THREE.Box3().setFromObject(
        cloned
      );

    const size =
      new THREE.Vector3();

    const center =
      new THREE.Vector3();

    box.getSize(size);
    box.getCenter(center);

    const largest =
      Math.max(
        size.x,
        size.y,
        size.z
      ) || 1;

    const scale =
      (EARTH_RADIUS * 2) / largest;

    cloned.scale.setScalar(scale);

    cloned.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale
    );

    return cloned;
  }, [scene]);

  return (
    <primitive object={earth} />
  );
}

/*
 * IMPORTANT:
 * There is deliberately NO artificial sphere or ring around the satellite.
 * The GLB itself is the satellite node.
 */
function SatelliteModel({
  selected,
  onClick,
}) {
  const { scene } = useGLTF(
    "/models/satellite.glb"
  );

  const satellite = useMemo(() => {
    const cloned = cloneSkinned(scene);

    const box =
      new THREE.Box3().setFromObject(
        cloned
      );

    const size =
      new THREE.Vector3();

    const center =
      new THREE.Vector3();

    box.getSize(size);
    box.getCenter(center);

    const largest =
      Math.max(
        size.x,
        size.y,
        size.z
      ) || 1;

    /*
     * Normalize the downloaded GLB so its largest dimension is
     * approximately 1.25 scene units. The GLB itself is the node.
     */
    const scale =
      1.25 / largest;

    cloned.scale.setScalar(scale);

    cloned.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale
    );

    cloned.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;

        // Keep the downloaded GLB appearance, but make very dark
        // satellite materials readable against the space background.
        if (object.material) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          materials.forEach((material) => {
            if (material.emissive) {
              material.emissive.set("#0b2630");
              material.emissiveIntensity = 0.35;
            }
          });
        }
      }
    });

    return cloned;
  }, [scene]);

  return (
    <group
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <primitive object={satellite} />

    </group>
  );
}

function OrbitRing({ orbit }) {
  const geometry = useMemo(() => {
    const points = [];
    const segments = 256;

    for (
      let i = 0;
      i <= segments;
      i += 1
    ) {
      const theta =
        (i / segments) *
        Math.PI *
        2;

      points.push(
        getOrbitPositionAtAngle(
          orbit,
          theta
        )
      );
    }

    return new THREE.BufferGeometry().setFromPoints(
      points
    );
  }, [orbit]);

  return (
    <line geometry={geometry} renderOrder={0}>
      <lineBasicMaterial
        color="#168cb7"
        transparent
        opacity={0.16}
        depthWrite={false}
      />
    </line>
  );
}

function GroundStation({
  id,
  position,
  selected,
  onClick,
}) {
  const groupRef = useRef();

  useFrame(() => {
    if (!groupRef.current) {
      return;
    }

    const outward =
      groupRef.current.position
        .clone()
        .normalize();

    groupRef.current.quaternion.setFromUnitVectors(
      UP,
      outward
    );
  });

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <mesh position={[0, 0.10, 0]}>
        <cylinderGeometry
          args={[
            0.12,
            0.17,
            0.20,
            16,
          ]}
        />

        <meshStandardMaterial
          color="#a855f7"
          emissive="#7c3aed"
          emissiveIntensity={2.4}
        />
      </mesh>

      <mesh position={[0, 0.27, 0]}>
        <coneGeometry
          args={[
            0.15,
            0.23,
            20,
          ]}
        />

        <meshStandardMaterial
          color="#c084fc"
          emissive="#8b5cf6"
          emissiveIntensity={2.5}
        />
      </mesh>

      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry
          args={[0.055, 12, 12]}
        />

        <meshBasicMaterial
          color="#ffffff"
        />
      </mesh>

      <mesh
        rotation={[
          Math.PI / 2,
          0,
          0,
        ]}
        position={[
          0,
          0.025,
          0,
        ]}
      >
        <ringGeometry
          args={[
            0.22,
            0.29,
            32,
          ]}
        />

        <meshBasicMaterial
          color={
            selected
              ? "#ffffff"
              : "#a855f7"
          }
          transparent
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html
        center
        distanceFactor={8}
        position={[
          0,
          0.72,
          0,
        ]}
      >
        <div className="space-node-label ground">
          {id}
        </div>
      </Html>
    </group>
  );
}

/* ==========================================================================
 * DYNAMIC EARTH-AVOIDING LINK ROUTING
 *
 * Every frame the satellites have moved, so every link is re-evaluated:
 *
 *  - Satellite <-> satellite: if the straight beam stays outside the
 *    clearance sphere it is drawn straight. If it would dip inside, the beam
 *    becomes a quadratic arc pushed away from the Earth by the SMALLEST amount
 *    that clears it (found by bisection), so the beam bends in gradually,
 *    follows the orbit, and straightens out again when the geometry allows.
 *
 *  - Ground <-> satellite (or ground <-> ground): always an elevated cubic arc
 *    that leaves the antenna radially outward. If the satellite is on the far
 *    side of the planet, the arc is lifted just enough to clear the Earth.
 *
 *  - One curve is computed per link per frame and cached, so the beam AND the
 *    travelling packet markers use exactly the same path.
 * ========================================================================== */

// Beams must stay at least this far from the Earth's centre
// (a little above the surface so they never graze the globe).
const LINK_CLEARANCE = EARTH_RADIUS * 1.12;

// Number of straight pieces used to draw each curved beam.
const LINK_SEGMENTS = 28;

const isGroundId = (id) => typeof id === "string" && id.startsWith("GS-");

// Scratch objects (avoid per-frame allocations in the hot loops).
const _sample = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

const COLOR_CORE_ACTIVE = new THREE.Color("#b8f9ff");
const COLOR_GLOW_ACTIVE = new THREE.Color("#00e5ff");
const COLOR_DOWN = new THREE.Color("#ff304f");
const COLOR_RISK = new THREE.Color("#ff9d3d");
const COLOR_RESTORE = new THREE.Color("#ffffff");
const DISRUPTION_IDS = new Set(["L4", "L5"]);

/* Smallest distance from the Earth's centre along part of a curve. */
function minCurveRadius(curve, t0 = 0, t1 = 1, samples = 24) {
  let min = Infinity;

  for (let i = 0; i <= samples; i += 1) {
    curve.getPoint(t0 + (t1 - t0) * (i / samples), _sample);
    const radius = _sample.length();
    if (radius < min) min = radius;
  }

  return min;
}

/*
 * Finds the smallest value in [0, maxValue] for which isOk() is true.
 * Used so a link is only bent as much as it really has to be, which keeps
 * the motion smooth and continuous while the satellites orbit.
 */
function solveMinimum(maxValue, isOk) {
  if (isOk(0)) return 0;
  if (!isOk(maxValue)) return maxValue;

  let lo = 0;
  let hi = maxValue;

  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (isOk(mid)) hi = mid;
    else lo = mid;
  }

  return hi * 1.03; // tiny safety margin
}

function buildSatelliteCurve(a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const lengthSq = d.lengthSq() || 1e-9;

  // Closest point of the segment a->b to the Earth's centre.
  const t = THREE.MathUtils.clamp(-a.dot(d) / lengthSq, 0, 1);
  const closest = a.clone().addScaledVector(d, t);
  const distance = closest.length();

  // Line of sight is clear: keep the beam perfectly straight.
  if (distance >= LINK_CLEARANCE) {
    return new THREE.LineCurve3(a.clone(), b.clone());
  }

  // Push the beam away from the Earth, in the direction of the closest point.
  const push = new THREE.Vector3();

  if (distance > 1e-3) {
    push.copy(closest).divideScalar(distance);
  } else {
    // Beam passes (almost) exactly through the centre: pick a stable side.
    push.crossVectors(d, UP);
    if (push.lengthSq() < 1e-6) push.crossVectors(d, X_AXIS);
    push.normalize();
  }

  const midpoint = a.clone().add(b).multiplyScalar(0.5);

  const make = (amount) =>
    new THREE.QuadraticBezierCurve3(
      a.clone(),
      midpoint.clone().addScaledVector(push, amount),
      b.clone()
    );

  const amount = solveMinimum(14, (value) =>
    minCurveRadius(make(value)) >= LINK_CLEARANCE
  );

  return make(amount);
}

/*
 * `a` is always the ground station. `bIsGround` is true for ground<->ground.
 */
function buildGroundCurve(a, b, bIsGround) {
  const distance = a.distanceTo(b);
  const lift = THREE.MathUtils.clamp(1.0 + distance * 0.04, 1.0, 1.5);

  const outwardA = a.clone().normalize();
  const p1 = a.clone().addScaledVector(outwardA, lift);

  const p2 = bIsGround
    ? b.clone().addScaledVector(b.clone().normalize(), lift)
    : b.clone().addScaledVector(a.clone().sub(b), 0.3);

  // Direction used to raise the whole arc when the far side is the Earth.
  const apex = a.clone().add(b).multiplyScalar(0.5);

  if (apex.length() > 0.4) {
    apex.normalize();
  } else {
    apex.crossVectors(b.clone().sub(a), UP);
    if (apex.lengthSq() < 1e-6) apex.crossVectors(b.clone().sub(a), X_AXIS);
    apex.normalize();
  }

  const make = (raise) =>
    new THREE.CubicBezierCurve3(
      a.clone(),
      p1.clone().addScaledVector(apex, raise),
      p2.clone().addScaledVector(apex, raise),
      b.clone()
    );

  // The ends sit on / near the surface, so only the interior is checked.
  const t0 = 0.14;
  const t1 = bIsGround ? 0.86 : 0.98;

  const raise = solveMinimum(12, (value) =>
    minCurveRadius(make(value), t0, t1) >= LINK_CLEARANCE
  );

  return make(raise);
}

/*
 * One curve per link per frame. The cache is keyed by the unordered node pair
 * and by the scene clock, so every beam and every packet marker that asks for
 * the same link in the same frame receives the identical path.
 */
const linkCurveCache = new Map();

function getLinkCurve(source, target, time) {
  if (!source || !target) return null;

  const key =
    source < target ? `${source}|${target}` : `${target}|${source}`;

  const cached = linkCurveCache.get(key);
  if (cached && cached.time === time) return cached;

  // Canonical orientation: ground station first, otherwise alphabetical.
  let from = source;
  let to = target;

  if (
    (isGroundId(to) && !isGroundId(from)) ||
    (isGroundId(from) === isGroundId(to) && from > to)
  ) {
    [from, to] = [to, from];
  }

  const a = getNodePosition(from, time);
  const b = getNodePosition(to, time);

  if (!a || !b) return null;

  const curve =
    isGroundId(from) || isGroundId(to)
      ? buildGroundCurve(a, b, isGroundId(to))
      : buildSatelliteCurve(a, b);

  const entry = { time, from, to, curve };
  linkCurveCache.set(key, entry);

  return entry;
}

/* Point along the (Earth-avoiding) link, travelling source -> target. */
function getLinkPoint(source, target, time, progress) {
  const entry = getLinkCurve(source, target, time);

  if (!entry) return null;

  const t = entry.from === source ? progress : 1 - progress;

  return entry.curve.getPoint(THREE.MathUtils.clamp(t, 0, 1));
}

/* Writes the beam's segments into an InstancedMesh of unit cylinders. */
function writeBeamMatrices(mesh, points) {
  if (!mesh) return;

  for (let i = 0; i < LINK_SEGMENTS; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];

    _dir.subVectors(p1, p0);
    const length = _dir.length();

    if (length < 1e-6) {
      _mid.copy(p0);
      _quat.identity();
      _scale.set(0, 0, 0);
    } else {
      _dir.divideScalar(length);
      _quat.setFromUnitVectors(UP, _dir);
      _mid.addVectors(p0, p1).multiplyScalar(0.5);
      _scale.set(1, length + 0.002, 1);
    }

    _mat.compose(_mid, _quat, _scale);
    mesh.setMatrixAt(i, _mat);
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = true;
}

function CommunicationLink({
  id,
  source,
  target,
  status,
  congestion = 0,
  showDisruptionCandidate = false,
  highlighted,
  selected,
  onClick,
}) {
  const glowRef = useRef();
  const coreRef = useRef();
  const pickRef = useRef();
  const badgeRef = useRef();
  const wasDownRef = useRef(false);
  const restoreUntilRef = useRef(0);
  const [hovered, setHovered] = useState(false);

  const points = useMemo(
    () =>
      Array.from(
        { length: LINK_SEGMENTS + 1 },
        () => new THREE.Vector3()
      ),
    []
  );

  const isActive = !["disrupted", "down", "inactive", "unusable"].includes(status);
  const isRisk = isActive && Number(congestion) >= 50;
  const isCandidate = showDisruptionCandidate && DISRUPTION_IDS.has(id);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const entry = getLinkCurve(
      source,
      target,
      now
    );

    if (!entry) return;

    for (let i = 0; i <= LINK_SEGMENTS; i += 1) {
      entry.curve.getPoint(i / LINK_SEGMENTS, points[i]);
    }

    writeBeamMatrices(glowRef.current, points);
    writeBeamMatrices(coreRef.current, points);
    writeBeamMatrices(pickRef.current, points);

    if (!isActive && !wasDownRef.current) {
      wasDownRef.current = true;
    } else if (isActive && wasDownRef.current) {
      wasDownRef.current = false;
      restoreUntilRef.current = now + 1.2;
    }

    const restoring = now < restoreUntilRef.current;
    const core = selected
      ? new THREE.Color("#ffe14a")
      : restoring
      ? COLOR_RESTORE
      : !isActive
      ? COLOR_DOWN
      : isRisk
      ? COLOR_RISK
      : COLOR_CORE_ACTIVE;
    const glow = selected
      ? new THREE.Color("#ffe14a")
      : restoring
      ? COLOR_RESTORE
      : !isActive
      ? COLOR_DOWN
      : isRisk
      ? COLOR_RISK
      : COLOR_GLOW_ACTIVE;

    if (coreRef.current) {
      coreRef.current.material.color.copy(core);
      coreRef.current.material.opacity = highlighted || selected || hovered ? 1 : isActive ? 0.82 : 0.92;
    }

    if (glowRef.current) {
      glowRef.current.material.color.copy(glow);
      glowRef.current.material.opacity = highlighted || selected || hovered ? 0.48 : isActive ? 0.13 : 0.12;
    }

    if (badgeRef.current) {
      entry.curve.getPoint(0.5, badgeRef.current.position);
    }
  });

  return (
    <group
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      <instancedMesh
        ref={glowRef}
        args={[undefined, undefined, LINK_SEGMENTS]}
        frustumCulled={false}
        visible={false}
      >
        <cylinderGeometry args={[selected ? 0.09 : 0.065, selected ? 0.09 : 0.065, 1, 10, 1, true]} />
        <meshBasicMaterial
          color="#00e5ff"
          transparent
          opacity={0.1}
          depthWrite={false}
        />
      </instancedMesh>

      <instancedMesh
        ref={coreRef}
        args={[undefined, undefined, LINK_SEGMENTS]}
        frustumCulled={false}
        visible={false}
      >
        <cylinderGeometry args={[selected ? 0.03 : 0.018, selected ? 0.03 : 0.018, 1, 8, 1, true]} />
        <meshBasicMaterial
          color="#b8f9ff"
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </instancedMesh>

      <instancedMesh
        ref={pickRef}
        args={[undefined, undefined, LINK_SEGMENTS]}
        frustumCulled={false}
        visible={false}
        className="space-link-hit"
      >
        <cylinderGeometry args={[0.22, 0.22, 1, 8, 1, true]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      {(isCandidate || !isActive || selected) && (
        <group ref={badgeRef}>
          <Html center distanceFactor={10} pointerEvents="none">
            <div className={`candidate-chip ${selected ? "selected" : !isActive ? "down" : ""}`} style={selected ? { borderColor: "#ffe14a", color: "#ffe14a", background: "rgba(35, 30, 5, 0.9)" } : undefined}>
              {selected ? `${id}: SELECTED` : !isActive ? "LINK DISABLED" : "DISRUPTION CANDIDATE"}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}


function MessageMarker({ message }) {
  const ref = useRef();
  // A packet that arrives in one hop is "delivered" in the very snapshot
  // that first contains it, so treat that like a first hop as well.
  const firstHop =
    ["in_transit", "delivered"].includes(message?.status) &&
    message?.hops === 1;
  const initialFrom = firstHop ? message.source : message?.current_node;

  const previousNodeRef = useRef(initialFrom);
  const fromNodeRef = useRef(initialFrom);
  const toNodeRef = useRef(message?.current_node);
  const animationStartRef = useRef(null);
  const [hopLabel, setHopLabel] = useState(
    `${message?.source || ""} → ${message?.current_node || ""}`
  );

  const isHigh =
    ["HIGH", "CRITICAL"].includes(String(message?.priority_class || "LOW").toUpperCase());
  const isStored =
    String(message?.status || "").toLowerCase() === "stored";
  const isDelivered =
    String(message?.status || "").toLowerCase() === "delivered";
  // A retransmitted copy of an earlier bundle is drawn in orange.
  const isCopy = Boolean(message?.copy_of);
  const color = isCopy ? "#ff9d3d" : isHigh ? "#ffe14a" : "#55dfff";

  useFrame((state) => {
    if (!ref.current) return;

    const now = state.clock.elapsedTime;
    const currentNode = message?.current_node;

    // The backend advances a message one DTN hop per simulation tick.
    // When current_node changes, animate that exact hop instead of
    // teleporting the packet to the new node.
    if (currentNode && currentNode !== previousNodeRef.current) {
      fromNodeRef.current = previousNodeRef.current || message.source;
      toNodeRef.current = currentNode;
      previousNodeRef.current = currentNode;
      animationStartRef.current = now;
      setHopLabel(`${fromNodeRef.current} → ${toNodeRef.current}`);
    }

    const animationStart = animationStartRef.current;

    if (animationStart !== null) {
      const duration = 0.95;
      const progress = Math.min(
        (now - animationStart) / duration,
        1
      );

      const position = getLinkPoint(
        fromNodeRef.current,
        toNodeRef.current,
        now,
        progress
      );

      if (position) {
        ref.current.visible = true;
        ref.current.position.copy(position);
      }

      if (progress >= 1) {
        animationStartRef.current = null;
      }

      return;
    }

    // Delivered packets are removed from the parent render list, but this
    // guard also hides the object immediately if the backend state changes
    // before React completes the next render.
    if (isDelivered) {
      ref.current.visible = false;
      return;
    }

    const position = getNodePosition(
      currentNode,
      now
    );

    if (!position) {
      ref.current.visible = false;
      return;
    }

    ref.current.visible = true;
    ref.current.position.copy(position);

    const pulse =
      1 + Math.sin(now * (isHigh ? 7 : 5)) * (isHigh ? 0.25 : 0.16);
    ref.current.scale.setScalar(pulse);
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[isHigh ? 0.105 : 0.065, 14, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isStored ? 0.65 : 1}
        />
      </mesh>

      <pointLight
        color={color}
        intensity={isHigh ? 2.4 : 0.8}
        distance={isHigh ? 1.8 : 1.2}
      />

      <Html
        center
        distanceFactor={8}
        position={[0, 0.45, 0]}
      >
        <div
          className={`space-message-label ${
            isCopy ? "copy" : isHigh ? "high" : "low"
          }`}
        >
          <strong>{message.id}</strong>
          <span>
            {isStored
              ? `BUFFERED at ${message.current_node}`
              : isCopy
              ? "COPY"
              : isHigh
              ? `⚡ ${message.priority_class} · ${hopLabel}`
              : hopLabel || message.priority_class || "LOW"}
          </span>
        </div>
      </Html>
    </group>
  );
}

/*
 * "Reached" / "duplicate rejected" / "dropped" callout pinned to the node.
 * It follows the node (satellites orbit), shows an expanding ring, and
 * fades out on its own. `slot` stacks simultaneous callouts on one node.
 */
function ArrivalCallout({ event, slot }) {
  const groupRef = useRef();
  const ringRef = useRef();
  const bornRef = useRef(null);

  const isDuplicate = event.kind === "duplicate";
  const isDropped = event.kind === "dropped";
  const color = isDropped ? "#f85149" : isDuplicate ? "#ff9d3d" : "#4dff91";

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    if (bornRef.current === null) bornRef.current = now;

    const position = getNodePosition(event.node, now);

    if (groupRef.current && position) {
      groupRef.current.position.copy(position);
    }

    if (ringRef.current) {
      const t = Math.min((now - bornRef.current) / 1.5, 1);

      ringRef.current.scale.setScalar(0.12 + t * 0.85);
      ringRef.current.material.opacity = (1 - t) * 0.55;
      ringRef.current.visible = t < 1;
    }
  });

  return (
    <group ref={groupRef}>
      {slot === 0 && (
        <mesh ref={ringRef}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      )}

      <Html
        center
        distanceFactor={8}
        position={[0, 0.8 + slot * 0.55, 0]}
      >
        <div className={`dtn-arrival ${isDropped ? "dropped" : isDuplicate ? "duplicate" : "reached"}`}>
          <b>
            {isDropped
              ? `\u2715 DROPPED AT ${event.node}`
              : isDuplicate
              ? "DUPLICATE REJECTED"
              : `\u2713 REACHED ${event.node}`}
          </b>
          <strong>{event.id}</strong>
          <span>
            {isDropped
              ? `${event.reason || "TTL expired or buffer full"}`
              : isDuplicate
              ? `copy of ${event.copyOf || "an earlier bundle"} \u00b7 already delivered`
              : `${event.delay != null ? `after ${event.delay} ticks` : "delivered"}${
                  event.verified ? " \u00b7 integrity verified" : ""
                }`}
          </span>
        </div>
      </Html>
    </group>
  );
}

function SceneContents({
  network,
  state,
  traffic,
  isSimulationRunning = false,
  selectedLinkId,
  onSelectLink,
  onToggleLink,
  onDisruptLink,
  onRestoreLink,
  onResetConditions,
}) {

  const satelliteRefs =
    useRef({});

  const [
    selected,
    setSelected,
  ] = useState(null);

  const [internalSelectedLink, setInternalSelectedLink] = useState(null);
  const [linkActionBusy, setLinkActionBusy] = useState(false);

  const networkNodes =
    network?.nodes ?? [];

  const rawLinks =
    network?.links ??
    network?.edges ??
    [];

  const links = useMemo(
    () =>
      rawLinks
        .map((link) => ({
          ...normalizeLink(link),
          congestion: Number(link.congestion || 0),
          latency: link.latency,
        }))
        .filter(
          (link) =>
            link.source &&
            link.target
        ),
    [rawLinks]
  );

  const activeSelectedLinkId = selectedLinkId || internalSelectedLink?.id;
  const selectedLinkObj = useMemo(() => {
    if (!activeSelectedLinkId) return null;
    return links.find((l) => l.id === activeSelectedLinkId) || internalSelectedLink;
  }, [activeSelectedLinkId, links, internalSelectedLink]);

  const handleLinkSelect = (link) => {
    if (activeSelectedLinkId === link?.id) {
      setInternalSelectedLink(null);
      onSelectLink?.(null);
    } else {
      setInternalSelectedLink(link);
      onSelectLink?.(link);
    }
  };

  const handleToggleLink = async (link, targetActive) => {
    try {
      setLinkActionBusy(true);
      if (targetActive) {
        if (onRestoreLink) {
          await onRestoreLink(link.id);
        } else {
          await apiRestoreLink(link.id);
        }
      } else {
        if (onDisruptLink) {
          await onDisruptLink(link.id);
        } else {
          await apiDisruptLink(link.id);
        }
      }
      onToggleLink?.(link, targetActive);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setLinkActionBusy(false);
    }
  };

  const handleResetLink = async (link) => {
    try {
      setLinkActionBusy(true);
      if (onResetConditions) {
        await onResetConditions(link.id);
      } else {
        await apiResetLinkConditions(link.id);
      }
      onToggleLink?.(link, true);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setLinkActionBusy(false);
    }
  };

  const { arrivals, landingIds, history } = useArrivals(state?.messages);

  const activeMessages = useMemo(() => {
    // Only messages that are still active in the DTN simulation are rendered.
    // Anything that has finished is removed from the 3D scene: delivered,
    // dropped, or "rejected" (a retransmitted copy refused by the duplicate
    // detector, which has already reached its destination).
    return (state?.messages || []).filter((message) => {
      const status = String(message?.status || "").toLowerCase();

      return (
        status !== "delivered" &&
        status !== "dropped" &&
        status !== "rejected"
      );
    });
  }, [state?.messages]);

  const sortedActiveMessages = useMemo(() => {
    return [...activeMessages].sort((a, b) => {
      const isHighA = ["HIGH", "CRITICAL"].includes(String(a.priority_class || "").toUpperCase());
      const isHighB = ["HIGH", "CRITICAL"].includes(String(b.priority_class || "").toUpperCase());
      if (isHighA && !isHighB) return -1;
      if (!isHighA && isHighB) return 1;
      return (b.priority_score || 0) - (a.priority_score || 0);
    });
  }, [activeMessages]);

  // A message dot is drawn only after the message has been sent. Packets
  // still waiting in their source queue have no dot. A packet that has just
  // been delivered keeps its dot for about a second, so its last hop into
  // the destination node is animated before it disappears.
  const markerMessages = useMemo(() => {
    const moving = activeMessages.filter(
      (message) =>
        String(message?.status || "").toLowerCase() !== "queued"
    );

    const landing = (state?.messages || []).filter(
      (message) =>
        landingIds.has(message.id) &&
        String(message?.status || "").toLowerCase() === "delivered"
    );

    return [...moving, ...landing];
  }, [activeMessages, landingIds, state?.messages]);

  // Stack simultaneous callouts on the same node, at most three per node.
  const arrivalSlots = useMemo(() => {
    const used = {};

    return arrivals.map((event) => {
      const slot = used[event.node] ?? 0;
      used[event.node] = slot + 1;
      return slot;
    });
  }, [arrivals]);

  const highlightedLinks = useMemo(() => {
    const result = new Set();

    activeMessages.forEach((message) => {
      const route = Array.isArray(message?.route_path)
        ? message.route_path
        : [];

      for (let index = 0; index < route.length - 1; index += 1) {
        const a = route[index];
        const b = route[index + 1];
        result.add(`${a}::${b}`);
        result.add(`${b}::${a}`);
      }
    });

    return result;
  }, [activeMessages]);

  const isRouteLinkHighlighted = (source, target) =>
    highlightedLinks.has(`${source}::${target}`) ||
    highlightedLinks.has(`${target}::${source}`);

  const satelliteIds =
    useMemo(() => {
      const ids = new Set(
        Object.keys(ORBITS)
      );

      networkNodes.forEach(
        (node) => {
          if (
            node?.id &&
            ORBITS[node.id]
          ) {
            ids.add(node.id);
          }
        }
      );

      return [...ids];
    }, [networkNodes]);

  const stationIds =
    useMemo(() => {
      const ids = new Set(
        Object.keys(
          GROUND_STATIONS
        )
      );

      networkNodes.forEach(
        (node) => {
          if (
            node?.id &&
            GROUND_STATIONS[
              node.id
            ]
          ) {
            ids.add(node.id);
          }
        }
      );

      return [...ids];
    }, [networkNodes]);

  const stationPositions =
    useMemo(() => {
      const result = {};

      stationIds.forEach(
        (id) => {
          const station =
            GROUND_STATIONS[id];

          result[id] =
            getGroundPosition(
              station.lat,
              station.lon
            );
        }
      );

      return result;
    }, [stationIds]);

  useFrame((state) => {
    const time =
      state.clock.elapsedTime;

    satelliteIds.forEach(
      (id) => {
        const satellite =
          satelliteRefs.current[
            id
          ];

        if (!satellite) {
          return;
        }

        const position =
          getNodePosition(
            id,
            time
          );

        if (!position) {
          return;
        }

        satellite.position.copy(
          position
        );

        const next =
          getNodePosition(
            id,
            time + 0.08
          );

        if (next) {
          const direction =
            next
              .clone()
              .sub(position)
              .normalize();

          satellite.lookAt(
            position
              .clone()
              .add(direction)
          );
        }
      }
    );
  });

  return (
    <>
      <color
        attach="background"
        args={["#02050b"]}
      />

      <ambientLight intensity={1.15} />

      <directionalLight
        position={[5, 7, 9]}
        intensity={2.5}
      />

      <pointLight
        position={[-5, -3, 6]}
        intensity={1.3}
        color="#398cff"
      />

      <Stars
        radius={80}
        depth={50}
        count={2200}
        factor={2}
        saturation={0}
        fade
        speed={0.08}
      />

      <EarthModel />

      {satelliteIds.map(
        (id) => (
          <OrbitRing
            key={`orbit-${id}`}
            orbit={ORBITS[id]}
          />
        )
      )}

      {stationIds.map(
        (id) => (
          <GroundStation
            key={id}
            id={id}
            position={
              stationPositions[id]
            }
            selected={
              selected === id
            }
            onClick={() =>
              setSelected(id)
            }
          />
        )
      )}

      {satelliteIds.map(
        (id) => (
          <group
            key={id}
            renderOrder={10}
            ref={(element) => {
              satelliteRefs.current[
                id
              ] = element;
            }}
          >
            <SatelliteModel
              selected={
                selected === id
              }
              onClick={() =>
                setSelected(id)
              }
            />

            <Html
              center
              distanceFactor={9}
              position={[
                0,
                1.05,
                0,
              ]}
            >
              <div className="space-node-label satellite">
                {id}
              </div>
            </Html>
          </group>
        )
      )}

      {links.map((link, index) => (
        <CommunicationLink
          key={link.id ?? `link-${index}`}
          id={link.id}
          source={link.source}
          target={link.target}
          status={link.status}
          congestion={link.congestion}
          showDisruptionCandidate={Boolean(isSimulationRunning || traffic?.running)}
          selected={activeSelectedLinkId === link.id}
          highlighted={
            isRouteLinkHighlighted(link.source, link.target) ||
            selected === link.source ||
            selected === link.target
          }
          onClick={() => handleLinkSelect(link)}
        />
      ))}

      {markerMessages.map((message) => (
        <MessageMarker key={message.id} message={message} />
      ))}

      {arrivals.map(
        (event, index) =>
          arrivalSlots[index] < 3 && (
            <ArrivalCallout
              key={event.key}
              event={event}
              slot={arrivalSlots[index]}
            />
          )
      )}

      <OrbitControls
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={7}
        maxDistance={20}
        rotateSpeed={0.35}
        zoomSpeed={0.55}
        panSpeed={0.20}
        screenSpacePanning
        target={[0, 0, 0]}
      />

      <Html fullscreen>
        <div className="space-scene-overlay">
          <div className="space-live-pill">
            <span />
            LIVE 3D CONSTELLATION
          </div>

          {selected && (
            <div className="space-selection-card">
              <strong>{selected}</strong>
              <span>
                {selected.startsWith("SAT-")
                  ? "Orbiting satellite"
                  : "Ground station"}
              </span>
            </div>
          )}

          {/* 3D Link Interactive Controller Card */}
          {selectedLinkObj && (
            <div className="space-link-card">
              <div className="space-link-header">
                <div>
                  <div className="space-link-tag">LINK CONTROLLER</div>
                  <strong>{selectedLinkObj.id}: {selectedLinkObj.source} ↔ {selectedLinkObj.target}</strong>
                </div>
                <button
                  type="button"
                  className="space-link-close"
                  onClick={() => {
                    setInternalSelectedLink(null);
                    onSelectLink?.(null);
                  }}
                  title="Close link controller"
                >
                  ✕
                </button>
              </div>

              {(() => {
                const isDown = ["disrupted", "down", "inactive", "unusable"].includes(selectedLinkObj.status) ||
                  (Number(selectedLinkObj.latency || 0) >= (network?.parameters?.max_latency || 100));

                return (
                  <>
                    <div className={`space-link-status ${isDown ? "disrupted" : "active"}`}>
                      Status: <b>{isDown ? "DISABLED / CUT" : "ACTIVE / OPERATIONAL"}</b>
                    </div>

                    <div className="space-link-metrics">
                      <span>
                        Latency
                        <b>{selectedLinkObj.latency ?? "—"} sim-ms</b>
                      </span>
                      <span>
                        Congestion
                        <b>{Number(selectedLinkObj.congestion || 0).toFixed(0)}%</b>
                      </span>
                    </div>

                    <div className="space-link-actions">
                      {isDown ? (
                        <button
                          type="button"
                          className="space-link-btn btn-enable"
                          disabled={linkActionBusy}
                          onClick={() => handleToggleLink(selectedLinkObj, true)}
                          title="Restore link to active operations"
                        >
                          🟢 Enable Link
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="space-link-btn btn-disable"
                          disabled={linkActionBusy}
                          onClick={() => handleToggleLink(selectedLinkObj, false)}
                          title="Disable/cut link to force DTN rerouting"
                        >
                          🔴 Disable Link
                        </button>
                      )}

                      <button
                        type="button"
                        className="space-link-btn btn-reset"
                        disabled={linkActionBusy}
                        onClick={() => handleResetLink(selectedLinkObj)}
                        title="Reset link conditions to defaults"
                      >
                        ↺ Reset
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {sortedActiveMessages.length > 0 && (
            <div className="space-route-card">
              <div className="space-route-title">ACTIVE DTN ROUTES</div>
              {sortedActiveMessages.slice(0, 4).map((message) => {
                const isHigh = ["HIGH", "CRITICAL"].includes(String(message.priority_class || "").toUpperCase());
                return (
                  <div className="space-route-row" key={`route-${message.id}`}>
                    <span className="space-route-id">
                      {message.id}
                      {isHigh && (
                        <span className="dtn-priority-pill high">HIGH</span>
                      )}
                      {message.copy_of && (
                        <em className="dtn-copy-tag">copy</em>
                      )}
                    </span>
                    <span className="space-route-path">
                      {(message.route_path?.length ? message.route_path : [message.current_node || message.source, message.destination])
                        .map((node, index, path) => (
                          <span key={`${message.id}-${node}-${index}`}>
                            {node}{index < path.length - 1 ? " → " : ""}
                          </span>
                        ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {history.length > 0 && (
            <div className="dtn-arrivals-card">
              <div className="dtn-arrivals-title">ARRIVALS & EVENTS</div>

              {history.slice(0, 4).map((event) => (
                <div
                  className={`dtn-arrivals-row ${event.kind}`}
                  key={event.key}
                >
                  <span className="dtn-arrivals-mark">
                    {event.kind === "dropped" ? "\u00d7" : event.kind === "duplicate" ? "\u00d7" : "\u2713"}
                  </span>
                  <span className="dtn-arrivals-id">{event.id}</span>
                  <span className="dtn-arrivals-text">
                    {event.kind === "dropped"
                      ? `dropped at ${event.node}${event.reason ? ` \u00b7 ${event.reason}` : ""}`
                      : event.kind === "duplicate"
                      ? `rejected at ${event.node}`
                      : `reached ${event.node}${
                          event.delay != null ? ` \u00b7 ${event.delay} ticks` : ""
                        }`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-controls-hint">
            <b>CLICK</b> a link to enable / disable &nbsp; • &nbsp;
            <b>DRAG</b> rotate &nbsp; • &nbsp;
            <b>SCROLL</b> zoom
          </div>
        </div>
      </Html>
    </>
  );
}

export default function SpaceScene({
  network,
  state,
  traffic,
  isSimulationRunning = false,
  selectedLinkId,
  onSelectLink,
  onToggleLink,
  onDisruptLink,
  onRestoreLink,
  onResetConditions,
}) {
  return (
    <div className="space-scene">
      <Canvas
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        camera={{
          position: [
            8.8,
            5.8,
            12.8,
          ],
          fov: 46,
          near: 0.1,
          far: 100,
        }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          powerPreference:
            "high-performance",
        }}
        fallback={
          <div className="webgl-fallback">
            WebGL is not available
            in this browser.
          </div>
        }
      >
        <SceneContents
          network={network}
          state={state}
          traffic={traffic}
          isSimulationRunning={isSimulationRunning || Boolean(traffic?.running)}
          selectedLinkId={selectedLinkId}
          onSelectLink={onSelectLink}
          onToggleLink={onToggleLink}
          onDisruptLink={onDisruptLink}
          onRestoreLink={onRestoreLink}
          onResetConditions={onResetConditions}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(
  "/models/earth.glb"
);

useGLTF.preload(
  "/models/satellite.glb"
);
