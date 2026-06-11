import { notFound } from 'next/navigation';
import { ScenePreview } from './scene-preview';

/**
 * Dev-only 3D stage gallery. Every scene from the 3D upgrade is mounted here
 * first and screenshot for user approval before it is wired into a game page.
 */
export default async function PreviewScenePage({
  params,
}: {
  params: Promise<{ scene: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { scene } = await params;
  return <ScenePreview scene={scene} />;
}
