// Renders clean, high-contrast 1080x1350 PNGs for Facebook posting.
// No external libraries - plain Canvas 2D, works fully offline, and uses
// only fonts that already ship with Windows (Bahnschrift / Segoe UI /
// Consolas) so posts render identically to how the admin sees them.

import { getGameSideName } from './entryDisplay';

const WIDTH = 1080;
const HEIGHT = 1350;
const NAVY = '#12213D';
const NAVY_LIGHT = '#1C3159';
const AMBER = '#F2A93B';
const CREAM = '#F7F3E8';
const HARDWOOD = '#C98A4B';
const WIN = '#2F9E44';

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas;
}

function drawBackground(ctx) {
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // Subtle court-line accents in the corners
  ctx.strokeStyle = 'rgba(242,169,59,0.15)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(WIDTH / 2, 140, 90, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHeader(ctx, eyebrow, title) {
  ctx.textAlign = 'center';
  ctx.fillStyle = AMBER;
  ctx.font = '600 28px "Segoe UI", sans-serif';
  ctx.fillText(eyebrow.toUpperCase(), WIDTH / 2, 90);

  ctx.fillStyle = CREAM;
  ctx.font = '700 64px Bahnschrift, "Arial Narrow", sans-serif';
  wrapText(ctx, title, WIDTH / 2, 165, WIDTH - 160, 68);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  const lines = [];
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  lines.forEach((l) => {
    ctx.fillText(l, x, curY);
    curY += lineHeight;
  });
  return curY;
}

function drawFooter(ctx, tournamentName) {
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(247,243,232,0.5)';
  ctx.font = '500 24px "Segoe UI", sans-serif';
  ctx.fillText(tournamentName, WIDTH / 2, HEIGHT - 50);
  ctx.strokeStyle = HARDWOOD;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(80, HEIGHT - 85);
  ctx.lineTo(WIDTH - 80, HEIGHT - 85);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMatchRow(ctx, y, teamA, teamB, scoreA, scoreB, sublabel) {
  const rowH = 90;
  ctx.fillStyle = NAVY_LIGHT;
  roundRect(ctx, 90, y, WIDTH - 180, rowH, 12);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = CREAM;
  ctx.font = '600 34px "Segoe UI", sans-serif';
  ctx.fillText(truncate(ctx, teamA, WIDTH - 420), 120, y + 40);
  ctx.fillText(truncate(ctx, teamB, WIDTH - 420), 120, y + 75);

  if (sublabel) {
    ctx.fillStyle = HARDWOOD;
    ctx.font = '600 20px "Segoe UI", sans-serif';
    ctx.fillText(sublabel, 120, y - 10);
  }

  if (scoreA !== undefined && scoreA !== null) {
    ctx.textAlign = 'right';
    ctx.fillStyle = AMBER;
    ctx.font = '700 40px Consolas, monospace';
    ctx.fillText(String(scoreA), WIDTH - 120, y + 40);
    ctx.fillText(String(scoreB), WIDTH - 120, y + 78);
  } else {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(247,243,232,0.4)';
    ctx.font = '600 26px "Segoe UI", sans-serif';
    ctx.fillText('VS', WIDTH - 120, y + 58);
  }

  return y + rowH + 24;
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(`${t}…`).width > maxWidth && t.length > 1) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function download(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve();
    }, 'image/png');
  });
}

export async function exportTodaysGames(games, tournamentName) {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawHeader(ctx, "Today's Games", tournamentName);

  let y = 300;
  const visible = games.slice(0, 8);
  visible.forEach((g) => {
    const time = g.scheduled_at ? new Date(g.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'TBA';
    y = drawMatchRow(ctx, y, getGameSideName(g, 'a'), getGameSideName(g, 'b'), null, null, `${time}${g.venue ? ' · ' + g.venue : ''}`);
  });
  if (games.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CREAM;
    ctx.font = '500 32px "Segoe UI", sans-serif';
    ctx.fillText('No games scheduled today.', WIDTH / 2, 400);
  }

  drawFooter(ctx, tournamentName);
  await download(canvas, 'todays-games.png');
}

export async function exportFinalScore(game, tournamentName) {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  const sideAName = getGameSideName(game, 'a');
  const sideBName = getGameSideName(game, 'b');
  drawHeader(ctx, game.round_label || 'Final Score', `${sideAName} vs ${sideBName}`);

  const y = 420;
  ctx.textAlign = 'center';
  ctx.fillStyle = CREAM;
  ctx.font = '600 40px "Segoe UI", sans-serif';
  ctx.fillText(sideAName, WIDTH / 2, y);
  ctx.fillStyle = AMBER;
  ctx.font = '700 140px Consolas, monospace';
  ctx.fillText(String(game.score_a ?? '-'), WIDTH / 2, y + 150);

  ctx.fillStyle = 'rgba(247,243,232,0.4)';
  ctx.font = '600 30px "Segoe UI", sans-serif';
  ctx.fillText('FINAL', WIDTH / 2, y + 210);

  ctx.fillStyle = CREAM;
  ctx.font = '600 40px "Segoe UI", sans-serif';
  ctx.fillText(sideBName, WIDTH / 2, y + 280);
  ctx.fillStyle = AMBER;
  ctx.font = '700 140px Consolas, monospace';
  ctx.fillText(String(game.score_b ?? '-'), WIDTH / 2, y + 430);

  drawFooter(ctx, tournamentName);
  await download(canvas, 'final-score.png');
}

export async function exportStandings(standings, groupName, tournamentName) {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawHeader(ctx, 'Updated Standings', groupName || tournamentName);

  let y = 300;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(247,243,232,0.5)';
  ctx.font = '600 22px "Segoe UI", sans-serif';
  ctx.fillText('#   TEAM', 100, y);
  ctx.textAlign = 'right';
  ctx.fillText('W - L   PTS', WIDTH - 100, y);
  y += 20;

  ctx.strokeStyle = 'rgba(247,243,232,0.2)';
  ctx.beginPath();
  ctx.moveTo(90, y);
  ctx.lineTo(WIDTH - 90, y);
  ctx.stroke();
  y += 40;

  standings.slice(0, 10).forEach((row) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = AMBER;
    ctx.font = '700 34px Bahnschrift, sans-serif';
    ctx.fillText(String(row.rank), 100, y);
    ctx.fillStyle = CREAM;
    ctx.font = '600 32px "Segoe UI", sans-serif';
    ctx.fillText(truncate(ctx, row.entryName || row.teamName, 560), 160, y);

    ctx.textAlign = 'right';
    ctx.font = '700 30px Consolas, monospace';
    ctx.fillStyle = CREAM;
    ctx.fillText(`${row.wins}-${row.losses}   ${row.leaguePoints}`, WIDTH - 100, y);
    y += 62;
  });

  drawFooter(ctx, tournamentName);
  await download(canvas, 'standings.png');
}

export async function exportMatchup(teamAName, teamBName, roundLabel, tournamentName) {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawHeader(ctx, roundLabel || 'Matchup', 'Who Advances?');

  const y = 480;
  ctx.textAlign = 'center';
  ctx.fillStyle = CREAM;
  ctx.font = '700 56px Bahnschrift, sans-serif';
  wrapText(ctx, teamAName || 'TBD', WIDTH / 2, y, WIDTH - 200, 60);

  ctx.fillStyle = AMBER;
  ctx.font = '700 40px "Segoe UI", sans-serif';
  ctx.fillText('VS', WIDTH / 2, y + 110);

  ctx.fillStyle = CREAM;
  ctx.font = '700 56px Bahnschrift, sans-serif';
  wrapText(ctx, teamBName || 'TBD', WIDTH / 2, y + 200, WIDTH - 200, 60);

  drawFooter(ctx, tournamentName);
  await download(canvas, 'matchup.png');
}

export async function exportChampion(championName, tournamentName, runnerUpName) {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);

  ctx.textAlign = 'center';
  ctx.fillStyle = AMBER;
  ctx.font = '600 30px "Segoe UI", sans-serif';
  ctx.fillText('CHAMPION'.split('').join(' '), WIDTH / 2, 200);

  ctx.font = '800 90px Bahnschrift, sans-serif';
  ctx.fillStyle = CREAM;
  const afterTitle = wrapText(ctx, championName, WIDTH / 2, 340, WIDTH - 140, 96);

  ctx.strokeStyle = HARDWOOD;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(200, afterTitle + 40);
  ctx.lineTo(WIDTH - 200, afterTitle + 40);
  ctx.stroke();
  ctx.setLineDash([]);

  if (runnerUpName) {
    ctx.fillStyle = 'rgba(247,243,232,0.6)';
    ctx.font = '500 28px "Segoe UI", sans-serif';
    ctx.fillText(`Runner-up: ${runnerUpName}`, WIDTH / 2, afterTitle + 100);
  }

  ctx.fillStyle = WIN;
  ctx.font = '700 26px "Segoe UI", sans-serif';
  ctx.fillText(tournamentName, WIDTH / 2, HEIGHT - 160);

  drawFooter(ctx, tournamentName);
  await download(canvas, 'champion.png');
}
