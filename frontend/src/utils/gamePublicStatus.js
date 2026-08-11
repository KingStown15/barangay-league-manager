function normalizeStatus(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_');
}

export function getPublicGameStatus(game) {
  const status = normalizeStatus(game?.status);
  const approved = Boolean(game?.approved_at || game?.approvedAt);

  if (status === 'ongoing' || status === 'live') {
    return { label: 'LIVE', helper: null, showLiveDot: true };
  }

  if (status === 'needs_approval' || status === 'pending_approval' || (status === 'completed' && !approved)) {
    return approved
      ? { label: 'FINAL', helper: null, showLiveDot: false }
      : { label: 'FULL TIME', helper: 'Awaiting admin approval', showLiveDot: false };
  }

  if (status === 'forfeited') {
    return {
      label: 'FORFEIT',
      helper: approved ? null : 'Awaiting admin approval',
      showLiveDot: false,
    };
  }

  if (status === 'completed' || status === 'approved' || approved) {
    return { label: 'FINAL', helper: null, showLiveDot: false };
  }

  return { label: 'SCHEDULED', helper: null, showLiveDot: false };
}
