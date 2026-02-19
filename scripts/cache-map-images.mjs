import fs from 'node:fs/promises';
import path from 'node:path';

const MAPS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTufS4N6N-30qHu47IuYFnR8CqjM9iTTWQLQ9d4w0SxpmdI984EcnbG8D4ZAerbtKzuxtTHAlHrZpHQ/pub?output=csv';
const MAP_IMAGE_BASE = 'https://stats.lamateam.eu/hlstatsimg/games/css/maps';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'public', 'assets', 'map-cache');
const OUT_JSON = path.join(ROOT, 'src', 'data', 'maps.generated.json');

function parseCsvLine(line, delimiter) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out;
}

function getCustomMapsFromCsv(raw) {
  const delimiter = raw.includes('";"') ? ';' : ',';
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const header = parseCsvLine(lines[0], delimiter).map((v) =>
    v.trim().replace(/^"|"$/g, ''),
  );

  let mapCol = header.findIndex((h) => h.toUpperCase() === 'MAPA');
  if (mapCol === -1) mapCol = 1;

  const uniq = new Set();
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], delimiter);
    if (row.length <= mapCol) continue;

    let name = (row[mapCol] ?? '').trim().replace(/^"|"$/g, '');
    if (!name) continue;
    if (name.toLowerCase().endsWith('.bsp')) name = name.slice(0, -4);
    if (name) uniq.add(name);
  }

  return [...uniq];
}

function fallbackMapNames(mapName) {
  const names = [mapName];
  let cur = mapName;
  while (cur.includes('_')) {
    cur = cur.replace(/_[^_]+$/, '');
    if (cur && !names.includes(cur)) names.push(cur);
  }
  return names;
}

async function downloadImage(url, outPath, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('image')) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 512) return false;
    await fs.writeFile(outPath, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function resolveAndCache(mapName) {
  const localName = `${mapName}.jpg`;
  const localPath = path.join(CACHE_DIR, localName);
  const publicPath = `/assets/map-cache/${localName}`;

  try {
    await fs.access(localPath);
    return { map: mapName, image: publicPath, source: 'cache' };
  } catch {}

  for (const base of fallbackMapNames(mapName)) {
    const candidates = [
      `${MAP_IMAGE_BASE}/${base}.jpg`,
      `${MAP_IMAGE_BASE}/${base}.jpeg`,
      `${MAP_IMAGE_BASE}/${base}.png`,
    ];

    for (const url of candidates) {
      if (await downloadImage(url, localPath)) {
        return { map: mapName, image: publicPath, source: url };
      }
    }
  }

  return { map: mapName, image: '/assets/map-placeholder.svg', source: 'placeholder' };
}

async function run() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });

  const csvRes = await fetch(MAPS_CSV_URL);
  if (!csvRes.ok) throw new Error(`CSV fetch failed: ${csvRes.status}`);
  const csv = await csvRes.text();
  const maps = getCustomMapsFromCsv(csv);

  const out = [];
  let ok = 0;

  for (const map of maps) {
    const item = await resolveAndCache(map);
    out.push(item);
    if (!item.image.includes('map-placeholder')) ok++;
  }

  await fs.writeFile(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), total: maps.length, ok, items: out }, null, 2));

  const percent = maps.length ? ((ok / maps.length) * 100).toFixed(1) : '0.0';
  console.log(`[maps] cached ${ok}/${maps.length} (${percent}%)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
