import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, PackageCheck, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';

export default function SystemUpdate() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    setLoading(true);
    api.get('/system-update/status')
      .then(setStatus)
      .catch((error) => setStatus({ state: 'error', error: error.message }))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function prepareUpdate() {
    const currentPassword = await confirm({
      title: 'Authorize system update',
      message: `Verify and prepare version ${status.update.version}. A verified database backup will be created first.`,
      input: true,
      inputType: 'password',
      inputLabel: 'Current super-admin password',
      inputPlaceholder: 'Required',
      confirmLabel: 'Verify & Prepare',
    });
    if (!currentPassword) return;
    setPreparing(true);
    try {
      const result = await api.post('/system-update/prepare', { currentPassword });
      toast.success(result.message);
      setStatus((current) => ({ ...current, state: 'prepared', preparedMessage: result.message }));
    } catch (error) {
      toast.error(error.message);
      load();
    } finally {
      setPreparing(false);
    }
  }

  async function cancelPreparedUpdate() {
    const currentPassword = await confirm({
      title: 'Cancel prepared update',
      message: 'Cancel this authorization so a fresh signed update can be prepared.',
      input: true,
      inputType: 'password',
      inputLabel: 'Current super-admin password',
      inputPlaceholder: 'Required',
      confirmLabel: 'Cancel Authorization',
      danger: true,
    });
    if (!currentPassword) return;
    setCancelling(true);
    try {
      const result = await api.post('/system-update/cancel', { currentPassword });
      toast.success(result.message);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div>
      <PageHeader title="System Update" subtitle="Super-admin-only release verification and preparation." />

      <div className="table-card" style={{ padding: '24px', maxWidth: '760px' }}>
        {loading && <p style={{ color: 'var(--color-text-muted)' }}>Checking the staged release package…</p>}

        {!loading && status?.state === 'ready' && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <PackageCheck size={28} style={{ color: 'var(--color-success)' }} />
              <div>
                <h2 className="text-lg font-bold">Verified update available</h2>
                <p style={{ color: 'var(--color-text-muted)' }}>
                  Version {status.current.version} → {status.update.version} · {status.update.files} signed files
                </p>
                {status.update.notes && <p className="mt-2">{status.update.notes}</p>}
              </div>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--color-surface-muted)' }}>
              Preparing the update verifies the signature and every file, creates a checked SQLite backup,
              and records your authorization. It does not install arbitrary uploads or commands.
            </div>
            {status.update.requires_network_or_cached_dependencies && (
              <div className="rounded-lg p-4" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
                This release changes dependency lockfiles. Keep a working internet connection or preloaded npm cache available during installation.
              </div>
            )}
            <Button onClick={prepareUpdate} disabled={preparing}>
              <ShieldCheck size={18} /> {preparing ? 'Preparing…' : 'Verify & Prepare Update'}
            </Button>
          </div>
        )}

        {!loading && ['prepared', 'expired'].includes(status?.state) && (
          <div className="space-y-4">
            {status.state === 'prepared'
              ? <ShieldCheck size={32} style={{ color: 'var(--color-success)' }} />
              : <AlertTriangle size={32} style={{ color: 'var(--color-danger)' }} />}
            <h2 className="text-lg font-bold">
              {status.state === 'prepared' ? 'Update prepared safely' : 'Prepared authorization expired'}
            </h2>
            <p>{status.preparedMessage || status.message}</p>
            <p style={{ color: 'var(--color-text-muted)' }}>
              {status.state === 'prepared'
                ? 'Close the server window, then run APPLY_UPDATE.bat on the server laptop. Do not remove the staged package or its verified backup.'
                : 'Cancel this authorization and prepare the verified package again.'}
            </p>
            <Button variant="danger" onClick={cancelPreparedUpdate} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel Prepared Update'}
            </Button>
          </div>
        )}

        {!loading && ['no_update', 'not_configured'].includes(status?.state) && (
          <div className="space-y-4">
            <RefreshCw size={28} style={{ color: 'var(--color-text-muted)' }} />
            <h2 className="text-lg font-bold">No installable update</h2>
            <p style={{ color: 'var(--color-text-muted)' }}>{status.message}</p>
            <Button variant="secondary" onClick={load}><RefreshCw size={17} /> Check Again</Button>
          </div>
        )}

        {!loading && ['invalid', 'error'].includes(status?.state) && (
          <div className="space-y-4">
            <AlertTriangle size={30} style={{ color: 'var(--color-danger)' }} />
            <h2 className="text-lg font-bold">Update rejected</h2>
            <p style={{ color: 'var(--color-danger)' }}>{status.error}</p>
            <Button variant="secondary" onClick={load}><RefreshCw size={17} /> Check Again</Button>
          </div>
        )}
      </div>
    </div>
  );
}
