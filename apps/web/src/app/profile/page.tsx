import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { ProfileContent } from './profile-content';

export default function ProfilePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-12">
            <h1 className="text-4xl font-bold mb-8">Profile</h1>
            <AuthGate>
              <ProfileContent />
            </AuthGate>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
