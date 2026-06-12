'use client';

import { forwardRef, useMemo } from 'react';
import { Shape, type Group } from 'three';
import { NEON, emissive } from '@/components/three/palette';

/**
 * Procedural rocket (no model files): cone nose + cylinder body + 3 extruded
 * swept fins + emissive window strip + nozzle ring. Built nose-up along +Y;
 * the rig orients the group along the curve tangent. ~6 draw calls.
 */
export const Rocket3D = forwardRef<Group, { scale?: number }>(function Rocket3D(
  { scale = 1 },
  ref,
) {
  const finShape = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.16, -0.16);
    shape.lineTo(0.13, -0.34);
    shape.lineTo(0, -0.22);
    shape.closePath();
    return shape;
  }, []);

  return (
    <group ref={ref} scale={scale}>
      {/* Nose cone */}
      <mesh position={[0, 0.42, 0]}>
        <coneGeometry args={[0.13, 0.3, 24]} />
        <meshStandardMaterial color="#EE86FF" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Body */}
      <mesh>
        <cylinderGeometry args={[0.13, 0.16, 0.56, 24]} />
        <meshStandardMaterial color="#d8d4f0" metalness={0.75} roughness={0.25} />
      </mesh>
      {/* Porthole — emissive cyan, feeds the bloom */}
      <mesh position={[0, 0.12, 0.125]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
        <meshStandardMaterial
          color="#0a3a44"
          emissive={emissive(NEON.cyan, 1)}
          emissiveIntensity={2.4}
        />
      </mesh>
      {/* Three swept fins */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle) => (
        <group key={angle} rotation={[0, angle, 0]}>
          <mesh position={[0.14, -0.18, 0]}>
            <extrudeGeometry args={[finShape, { depth: 0.025, bevelEnabled: false }]} />
            <meshStandardMaterial color="#6F5FCC" metalness={0.6} roughness={0.35} />
          </mesh>
        </group>
      ))}
      {/* Nozzle */}
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.1, 16]} />
        <meshStandardMaterial color="#332e52" metalness={0.9} roughness={0.4} />
      </mesh>
      {/* Inner glow of the burn — always-hot disc just inside the nozzle */}
      <mesh position={[0, -0.37, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.08, 16]} />
        <meshStandardMaterial
          color="#7a3000"
          emissive={emissive(NEON.amber, 1)}
          emissiveIntensity={2.8}
        />
      </mesh>
    </group>
  );
});
