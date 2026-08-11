import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';

export default function ChangePassword() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      logout();
      toast.success('Password changed. Sign in again with your new password.');
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Change Password" subtitle="Changing your password signs out all existing sessions." />
      <div className="table-card" style={{ padding: '24px', maxWidth: '560px' }}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="form-label">Current password</label>
            <input type="password" className="form-input" required autoComplete="current-password"
              value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
          </div>
          <div>
            <label className="form-label">New password</label>
            <input type="password" className="form-input" required minLength={10} autoComplete="new-password"
              value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} />
          </div>
          <div>
            <label className="form-label">Confirm new password</label>
            <input type="password" className="form-input" required minLength={10} autoComplete="new-password"
              value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
          </div>
          {error && <div className="field-error">{error}</div>}
          <Button type="submit" disabled={saving}>
            <KeyRound size={18} /> {saving ? 'Changing…' : 'Change Password & Sign Out'}
          </Button>
        </form>
      </div>
    </div>
  );
}
