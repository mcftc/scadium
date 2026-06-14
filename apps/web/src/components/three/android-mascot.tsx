'use client';

import type { Ref } from 'react';
import type { Group } from 'three';
import { NEON, emissive } from './palette';

/**
 * Refs the host scene drives to animate the mascot. All are optional — a static
 * dealer needs none, the coinflip tosser drives the torso lean and the right
 * arm chain. Joint pivots: arms hang from the shoulder (rotation.z swings them
 * in the camera plane), forearms bend at the elbow, the head pans/tilts.
 */
export interface MascotRig {
  torso?: Ref<Group>;
  head?: Ref<Group>;
  rUpperArm?: Ref<Group>;
  rForeArm?: Ref<Group>;
  rHand?: Ref<Group>;
  lUpperArm?: Ref<Group>;
  lForeArm?: Ref<Group>;
}

export interface AndroidMascotProps {
  rig?: MascotRig;
  /** Neon accent for the visor, chest core and antenna (defaults to cyan). */
  accent?: string;
  /** Hide the legs for a seated/behind-the-table dealer pose. */
  legs?: boolean;
}

const BODY = '#262238';
const PANEL = '#3b3660';
const JOINT = '#15121f';
const UPPER_ARM = 0.34;
const FORE_ARM = 0.32;

/**
 * A procedural neon-android casino host. Shared between the coinflip tosser and
 * the blackjack dealer so the brand reads as one character. Built from
 * primitives — no model files, no network fetch. Placed by the host scene; its
 * own origin sits at the floor between the feet.
 */
export function AndroidMascot({ rig = {}, accent = NEON.cyan, legs = true }: AndroidMascotProps) {
  const accentColor = emissive(accent, 1);

  return (
    <group>
      {legs ? (
        <group>
          {[-0.16, 0.16].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 0.18, 0]}>
                <capsuleGeometry args={[0.1, 0.26, 6, 12]} />
                <meshStandardMaterial color={BODY} metalness={0.85} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.5, 0]}>
                <capsuleGeometry args={[0.11, 0.24, 6, 12]} />
                <meshStandardMaterial color={PANEL} metalness={0.8} roughness={0.4} />
              </mesh>
              <mesh position={[0, 0.03, 0.06]}>
                <boxGeometry args={[0.18, 0.08, 0.26]} />
                <meshStandardMaterial color={JOINT} metalness={0.7} roughness={0.5} />
              </mesh>
            </group>
          ))}
        </group>
      ) : null}

      {/* Pelvis — the lean pivot sits on top of it. */}
      <mesh position={[0, legs ? 0.74 : 0.16, 0]}>
        <boxGeometry args={[0.42, 0.18, 0.3]} />
        <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
      </mesh>

      <group ref={rig.torso} position={[0, legs ? 0.82 : 0.24, 0]}>
        {/* Torso shell. */}
        <mesh position={[0, 0.34, 0]}>
          <capsuleGeometry args={[0.3, 0.42, 8, 20]} />
          <meshStandardMaterial color={BODY} metalness={0.88} roughness={0.32} />
        </mesh>
        {/* Chest plate + glowing core. */}
        <mesh position={[0, 0.42, 0.235]} rotation={[0.12, 0, 0]}>
          <boxGeometry args={[0.34, 0.34, 0.06]} />
          <meshStandardMaterial color={PANEL} metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.42, 0.27]}>
          <circleGeometry args={[0.06, 24]} />
          <meshStandardMaterial emissive={accentColor} emissiveIntensity={2.4} color="#10131a" />
        </mesh>
        {/* Collar. */}
        <mesh position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.13, 0.17, 0.1, 16]} />
          <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
        </mesh>

        {/* Head. */}
        <group ref={rig.head} position={[0, 0.82, 0]}>
          <mesh>
            <boxGeometry args={[0.34, 0.32, 0.32]} />
            <meshStandardMaterial color={PANEL} metalness={0.86} roughness={0.28} />
          </mesh>
          {/* Bevel cheeks. */}
          <mesh position={[0, -0.02, 0]}>
            <boxGeometry args={[0.36, 0.2, 0.3]} />
            <meshStandardMaterial color={BODY} metalness={0.86} roughness={0.3} />
          </mesh>
          {/* Visor inset. */}
          <mesh position={[0, 0.02, 0.165]}>
            <boxGeometry args={[0.3, 0.12, 0.02]} />
            <meshStandardMaterial color="#07090d" metalness={0.5} roughness={0.6} />
          </mesh>
          {/* Eyes. */}
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, 0.02, 0.18]}>
              <sphereGeometry args={[0.035, 14, 10]} />
              <meshStandardMaterial emissive={accentColor} emissiveIntensity={2.8} color="#082a33" />
            </mesh>
          ))}
          {/* Antenna. */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.14, 6]} />
            <meshStandardMaterial color={BODY} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.29, 0]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <meshStandardMaterial emissive={emissive(NEON.purple, 1)} emissiveIntensity={2.6} color="#3a1a40" />
          </mesh>
        </group>

        {/* Right arm chain (the throwing arm). Shoulder pivot. */}
        <group ref={rig.rUpperArm} position={[0.36, 0.52, 0]}>
          <mesh position={[0, 0.01, 0]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
          </mesh>
          <mesh position={[0, -UPPER_ARM / 2, 0]}>
            <capsuleGeometry args={[0.075, UPPER_ARM - 0.04, 6, 12]} />
            <meshStandardMaterial color={BODY} metalness={0.86} roughness={0.32} />
          </mesh>
          {/* Elbow pivot. */}
          <group ref={rig.rForeArm} position={[0, -UPPER_ARM, 0]}>
            <mesh>
              <sphereGeometry args={[0.07, 14, 10]} />
              <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
            </mesh>
            <mesh position={[0, -FORE_ARM / 2, 0]}>
              <capsuleGeometry args={[0.062, FORE_ARM - 0.04, 6, 12]} />
              <meshStandardMaterial color={PANEL} metalness={0.84} roughness={0.34} />
            </mesh>
            {/* Hand / claw. */}
            <group ref={rig.rHand} position={[0, -FORE_ARM, 0]}>
              <mesh>
                <sphereGeometry args={[0.085, 14, 10]} />
                <meshStandardMaterial color={BODY} metalness={0.86} roughness={0.3} />
              </mesh>
              {[-0.5, 0.5].map((s) => (
                <mesh key={s} position={[s * 0.06, -0.06, 0.03]} rotation={[0.3, 0, s * 0.4]}>
                  <capsuleGeometry args={[0.018, 0.07, 4, 8]} />
                  <meshStandardMaterial color={PANEL} metalness={0.82} roughness={0.36} />
                </mesh>
              ))}
            </group>
          </group>
        </group>

        {/* Left arm chain (idle support). Shoulder pivot, slightly bent. */}
        <group ref={rig.lUpperArm} position={[-0.36, 0.52, 0]} rotation={[0, 0, 0.32]}>
          <mesh position={[0, 0.01, 0]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
          </mesh>
          <mesh position={[0, -UPPER_ARM / 2, 0]}>
            <capsuleGeometry args={[0.075, UPPER_ARM - 0.04, 6, 12]} />
            <meshStandardMaterial color={BODY} metalness={0.86} roughness={0.32} />
          </mesh>
          <group ref={rig.lForeArm} position={[0, -UPPER_ARM, 0]} rotation={[0, 0, -0.5]}>
            <mesh>
              <sphereGeometry args={[0.07, 14, 10]} />
              <meshStandardMaterial color={JOINT} metalness={0.8} roughness={0.4} />
            </mesh>
            <mesh position={[0, -FORE_ARM / 2, 0]}>
              <capsuleGeometry args={[0.062, FORE_ARM - 0.04, 6, 12]} />
              <meshStandardMaterial color={PANEL} metalness={0.84} roughness={0.34} />
            </mesh>
            <mesh position={[0, -FORE_ARM, 0]}>
              <sphereGeometry args={[0.085, 14, 10]} />
              <meshStandardMaterial color={BODY} metalness={0.86} roughness={0.3} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

export { UPPER_ARM, FORE_ARM };
