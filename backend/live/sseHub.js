const clients = new Map();

function addClient(tournamentId, res) {
  const tid = String(tournamentId);
  if (!clients.has(tid)) clients.set(tid, new Set());
  clients.get(tid).add(res);
}

function removeClient(tournamentId, res) {
  const tid = String(tournamentId);
  const set = clients.get(tid);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(tid);
  }
}

function broadcast(tournamentId, event) {
  const tid = String(tournamentId);
  const set = clients.get(tid);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
}

function broadcastAll(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const [, set] of clients) {
    for (const res of set) {
      try { res.write(data); } catch { set.delete(res); }
    }
  }
}

function clientCount(tournamentId) {
  const tid = String(tournamentId);
  return clients.has(tid) ? clients.get(tid).size : 0;
}

module.exports = { addClient, removeClient, broadcast, broadcastAll, clientCount };
