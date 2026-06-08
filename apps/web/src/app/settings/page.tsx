import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { SettingsContent } from './settings-content';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <Container>
      <div className="py-12 max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Settings</h1>
        <AuthGate>
          <SettingsContent />
        </AuthGate>
      </div>
    </Container>
  );
}
