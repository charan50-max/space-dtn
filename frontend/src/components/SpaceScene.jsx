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

/*
 * SPACE DTN — 3D CONSTELLATION
 *
 * Design:
 * - Earth stays compact enough that every orbital plane remains visible.
 * - Each satellite has one fixed orbital plane and moves slowly around it.
 * - The actual satellite.glb is the visible node. No artificial sphere/ring
 *   is drawn around the satellite.
 * - Satellite-to-satellite links are straight dynamic beams.
 * - Satellite-to-ground links are dynamic elevated arcs so the beam remains
 *   visible instead of disappearing through the Earth.
 * - Ground stations are separated geographically so they are visually distinct.
 */

const EARTH_RADIUS = 1.65;

/*
 * Five deliberately separated orbital planes.
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

function positionCylinder(
  ref,
  start,
  end
) {
  if (!ref.current) {
    return;
  }

  const direction =
    new THREE.Vector3().subVectors(
      end,
      start
    );

  const distance =
    direction.length();

  if (distance <= 0.001) {
    return;
  }

  direction.normalize();

  ref.current.position
    .copy(start)
    .add(end)
    .multiplyScalar(0.5);

  ref.current.quaternion.setFromUnitVectors(
    UP,
    direction
  );

  ref.current.scale.set(
    1,
    distance,
    1
  );
}

function quadraticPoint(
  a,
  control,
  b,
  t
) {
  const oneMinus = 1 - t;

  return new THREE.Vector3(
    oneMinus * oneMinus * a.x +
      2 *
        oneMinus *
        t *
        control.x +
      t * t * b.x,

    oneMinus * oneMinus * a.y +
      2 *
        oneMinus *
        t *
        control.y +
      t * t * b.y,

    oneMinus * oneMinus * a.z +
      2 *
        oneMinus *
        t *
        control.z +
      t * t * b.z
  );
}

/*
 * Ground links use a raised quadratic arc.
 * Satellite-to-satellite links stay straight.
 */
function getGroundLinkControl(
  start,
  end
) {
  const midpoint =
    start
      .clone()
      .add(end)
      .multiplyScalar(0.5);

  const distance =
    start.distanceTo(end);

  const lift =
    THREE.MathUtils.clamp(
      1.05 +
        distance * 0.10,
      1.15,
      1.85
    );

  const control =
    midpoint.normalize().multiplyScalar(
      EARTH_RADIUS + lift
    );

  return control;
}

function getLinkPoint(source, target, time, progress) {
  const start = getNodePosition(source, time);
  const end = getNodePosition(target, time);

  if (!start || !end) return null;

  const isGroundLink =
    source.startsWith("GS-") || target.startsWith("GS-");

  if (isGroundLink) {
    const control = getGroundLinkControl(start, end);
    return quadraticPoint(start, control, end, progress);
  }

  return start.clone().lerp(end, progress);
}

function CommunicationLink({
  source,
  target,
  status,
  highlighted,
}) {
  const coreA = useRef();
  const coreB = useRef();

  const glowA = useRef();
  const glowB = useRef();

  const isActive =
    ![
      "disrupted",
      "down",
      "inactive",
    ].includes(status);

  const isGroundLink =
    source.startsWith("GS-") ||
    target.startsWith("GS-");

  useFrame((state) => {
    const time =
      state.clock.elapsedTime;

    const start =
      getNodePosition(
        source,
        time
      );

    const end =
      getNodePosition(
        target,
        time
      );

    if (!start || !end) {
      return;
    }

    let control = null;

    if (isGroundLink) {
      control =
        getGroundLinkControl(
          start,
          end
        );
    }

    const midpoint =
      control
        ? quadraticPoint(
            start,
            control,
            end,
            0.5
          )
        : start
            .clone()
            .lerp(end, 0.5);

    positionCylinder(
      coreA,
      start,
      midpoint
    );

    positionCylinder(
      coreB,
      midpoint,
      end
    );

    positionCylinder(
      glowA,
      start,
      midpoint
    );

    positionCylinder(
      glowB,
      midpoint,
      end
    );

    const coreColor =
      isActive
        ? "#b8f9ff"
        : "#ff304f";

    const glowColor =
      isActive
        ? "#00e5ff"
        : "#ff304f";

    const coreOpacity =
      highlighted
        ? 1
        : isActive
        ? 0.82
        : 0.92;

    const glowOpacity =
      highlighted
        ? 0.32
        : isActive
        ? 0.13
        : 0.10;

    [
      coreA,
      coreB,
    ].forEach((ref) => {
      if (!ref.current) {
        return;
      }

      ref.current.material.color.set(
        coreColor
      );

      ref.current.material.opacity =
        coreOpacity;
    });

    [
      glowA,
      glowB,
    ].forEach((ref) => {
      if (!ref.current) {
        return;
      }

      ref.current.material.color.set(
        glowColor
      );

      ref.current.material.opacity =
        glowOpacity;
    });

  });

  return (
    <group>
      {[glowA, glowB].map(
        (ref, index) => (
          <mesh
            key={`glow-${index}`}
            ref={ref}
          >
            <cylinderGeometry
              args={[
                0.065,
                0.065,
                1,
                10,
              ]}
            />

            <meshBasicMaterial
              color="#00e5ff"
              transparent
              opacity={0.10}
              depthWrite={false}
            />
          </mesh>
        )
      )}

      {[coreA, coreB].map(
        (ref, index) => (
          <mesh
            key={`core-${index}`}
            ref={ref}
          >
            <cylinderGeometry
              args={[
                0.018,
                0.018,
                1,
                8,
              ]}
            />

            <meshBasicMaterial
              color="#b8f9ff"
              transparent
              opacity={0.8}
              depthWrite={false}
            />
          </mesh>
        )
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

  const isHigh =
    String(message?.priority_class || "LOW").toUpperCase() === "HIGH";
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
      1 + Math.sin(now * 5) * 0.16;
    ref.current.scale.setScalar(pulse);
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[isHigh ? 0.095 : 0.065, 12, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isStored ? 0.65 : 1}
        />
      </mesh>

      <pointLight
        color={color}
        intensity={isHigh ? 1.8 : 0.8}
        distance={1.2}
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
              ? "STORED"
              : isCopy
              ? "COPY"
              : message.priority_class || "LOW"}
          </span>
        </div>
      </Html>
    </group>
  );
}

/*
 * "Reached" / "duplicate rejected" callout pinned to the destination node.
 * It follows the node (satellites orbit), shows an expanding ring, and
 * fades out on its own. `slot` stacks simultaneous callouts on one node.
 */
function ArrivalCallout({ event, slot }) {
  const groupRef = useRef();
  const ringRef = useRef();
  const bornRef = useRef(null);

  const isDuplicate = event.kind === "duplicate";
  const color = isDuplicate ? "#ff9d3d" : "#4dff91";

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
        <div className={`dtn-arrival ${isDuplicate ? "duplicate" : "reached"}`}>
          <b>
            {isDuplicate
              ? "DUPLICATE REJECTED"
              : `\u2713 REACHED ${event.node}`}
          </b>
          <strong>{event.id}</strong>
          <span>
            {isDuplicate
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
}) {

  const satelliteRefs =
    useRef({});

  const [
    selected,
    setSelected,
  ] = useState(null);

  const networkNodes =
    network?.nodes ?? [];

  const rawLinks =
    network?.links ??
    network?.edges ??
    [];

  const links = useMemo(
    () =>
      rawLinks
        .map(normalizeLink)
        .filter(
          (link) =>
            link.source &&
            link.target
        ),
    [rawLinks]
  );

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

      {links.map(
        (link, index) => (
          <CommunicationLink
            key={
              link.id ??
              `link-${index}`
            }
            source={
              link.source
            }
            target={
              link.target
            }
            status={
              link.status
            }
            highlighted={
              isRouteLinkHighlighted(link.source, link.target) ||
              selected === link.source ||
              selected === link.target
            }
          />
        )
      )}

      {markerMessages.map((message) => (
        <MessageMarker
          key={message.id}
          message={message}
        />
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

          {activeMessages.length > 0 && (
            <div className="space-route-card">
              <div className="space-route-title">ACTIVE DTN ROUTES</div>
              {activeMessages.slice(0, 4).map((message) => (
                <div className="space-route-row" key={`route-${message.id}`}>
                  <span className="space-route-id">
                    {message.id}
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
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="dtn-arrivals-card">
              <div className="dtn-arrivals-title">ARRIVALS</div>

              {history.slice(0, 4).map((event) => (
                <div
                  className={`dtn-arrivals-row ${event.kind}`}
                  key={event.key}
                >
                  <span className="dtn-arrivals-mark">
                    {event.kind === "duplicate" ? "\u00d7" : "\u2713"}
                  </span>
                  <span className="dtn-arrivals-id">{event.id}</span>
                  <span className="dtn-arrivals-text">
                    {event.kind === "duplicate"
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
            <b>DRAG</b> rotate
            &nbsp; • &nbsp;
            <b>SCROLL</b> zoom
            &nbsp; • &nbsp;
            <b>CLICK</b> node
          </div>
        </div>
      </Html>
    </>
  );
}

export default function SpaceScene({
  network,
  state,
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
