import { useEffect, useState } from 'react';
import { Shield, ShieldOff, KeyRound } from 'lucide-react';
import { api } from '../api/client';
import Badge from '../components/ui/Badge';
import PageHeader from '../components/ui/PageHeader';
import ModalBase from '../components/ModalBase';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { SkeletonTable } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { isSuperAdminRole } from '../utils/roles';

const emptyForm = { username: '', password: '', role: 'scorer' };

export default function Users() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.get('/auth/users')
      .then((d) => setUsers(d.users))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      let currentPassword;
      if (isSuperAdminRole(form.role)) {
        currentPassword = await confirm({
          title: 'Authorize super-admin account',
          message: 'Creating another super admin grants system-update and account-control permissions.',
          input: true,
          inputType: 'password',
          inputLabel: 'Your current super-admin password',
          inputPlaceholder: 'Required',
          confirmLabel: 'Authorize & Create',
        });
        if (!currentPassword) return;
      }
      await api.post('/auth/users', { ...form, currentPassword });
      toast.success(`Account "${form.username}" created.`);
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleStatus(user) {
    const next = user.status === 'active' ? 'inactive' : 'active';
    try {
      let currentPassword;
      if (isSuperAdminRole(user.role)) {
        currentPassword = await confirm({
          title: `${next === 'active' ? 'Reactivate' : 'Deactivate'} super admin`,
          message: `Authorize this privileged account change for "${user.username}".`,
          input: true,
          inputType: 'password',
          inputLabel: 'Your current super-admin password',
          inputPlaceholder: 'Required',
          confirmLabel: 'Authorize Change',
          danger: next === 'inactive',
        });
        if (!currentPassword) return;
      }
      await api.patch(`/auth/users/${user.id}/status`, { status: next, currentPassword });
      toast.success(`"${user.username}" ${next === 'active' ? 'reactivated' : 'deactivated'}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function resetPassword(user) {
    const newPassword = await confirm({
      title: 'Reset password',
      message: `Set a new password for "${user.username}".`,
      input: true,
      inputType: 'password',
      inputLabel: 'New password',
      inputPlaceholder: 'Min 10 characters',
      inputMinLength: 10,
      confirmLabel: 'Reset Password',
    });
    if (!newPassword) return;
    try {
      let currentPassword;
      if (isSuperAdminRole(user.role)) {
        currentPassword = await confirm({
          title: 'Authorize super-admin password reset',
          message: `Confirm your authority to reset "${user.username}".`,
          input: true,
          inputType: 'password',
          inputLabel: 'Your current super-admin password',
          inputPlaceholder: 'Required',
          confirmLabel: 'Authorize Reset',
          danger: true,
        });
        if (!currentPassword) return;
      }
      await api.post(`/auth/users/${user.id}/reset-password`, { newPassword, currentPassword });
      toast.success(`Password reset for "${user.username}".`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        action={
          <Button onClick={() => { setShowForm(true); setForm(emptyForm); setError(''); }}>
            <Shield size={18} strokeWidth={2.5} /> Create Account
          </Button>
        }
      />

      <ModalBase isOpen={showForm} onClose={() => { setShowForm(false); setForm(emptyForm); setError(''); }} title="Create Account" subtitle="Add a scorer, admin, or authorized super-admin account." size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); setError(''); }}>Cancel</button>
            <button type="submit" form="user-form" className="btn-primary">Create Account</button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleCreate}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <label className="form-label">Username <span className="required">*</span></label>
              <input className="form-input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Password <span className="required">*</span></label>
              <input type="password" className="form-input" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Role <span className="required">*</span></label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="scorer">Scorer</option>
                <option value="admin">Admin</option>
                {isSuperAdminRole(currentUser.role) && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
          </div>
          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>

      {loading && <SkeletonTable rows={4} cols={4} />}

      {!loading && users.length === 0 && (
        <EmptyState icon={Shield} title="No accounts yet" description="Create a scorer or admin account above." />
      )}

      {!loading && users.length > 0 && (
        <div className="table-card">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td className="capitalize">{u.role}</td>
                    <td><Badge variant={u.status}>{u.status}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        className="btn-ghost text-xs"
                        disabled={isSuperAdminRole(u.role) && !isSuperAdminRole(currentUser.role)}
                        onClick={() => resetPassword(u)}
                      >
                        <KeyRound size={14} strokeWidth={2} /> Reset Password
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        disabled={u.id === currentUser.id || (isSuperAdminRole(u.role) && !isSuperAdminRole(currentUser.role))}
                        style={{ color: u.status === 'active' ? 'var(--color-warning)' : 'var(--color-success)' }}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'active' ? <ShieldOff size={14} strokeWidth={2} /> : <Shield size={14} strokeWidth={2} />}
                        {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
