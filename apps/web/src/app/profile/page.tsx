import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { ProfileContent } from './profile-content';

export const metadata = { title: 'Profile' };

export default function ProfilePage() {
  return (
    <Container>
      <div className="py-12">
        <h1 className="text-4xl font-bold mb-8">Profile</h1>
        <AuthGate>
          <ProfileContent />
        </AuthGate>
      </div>
    </Container>
  );
}
