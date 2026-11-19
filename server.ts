import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import JSZip from 'jszip';

interface FolderRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface PhotoRecord {
  id: string;
  folderId: string;
  fileName: string;
  diskName: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  qualityLabel: string;
  createdAt: string;
}

interface StoreDatabase {
  folders: FolderRecord[];
  photos: PhotoRecord[];
}

const PORT = Number(process.env.PORT) || 3000;
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(process.cwd(), 'storage');
const PHOTOS_DIR = path.join(STORAGE_ROOT, 'photos');
const DB_PATH = path.join(STORAGE_ROOT, 'db.json');

const VALID_LOGIN_ID = 'STORES';
const VALID_PASSWORD = '1234';
const TOKEN_SECRET = process.env.SESSION_SECRET || 'storelens-stores-1234-hmac-key';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function ensureStorageReady(): void {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial: StoreDatabase = { folders: [], photos: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDb(): StoreDatabase {
  ensureStorageReady();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreDatabase>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch {
    return { folders: [], photos: [] };
  }
}

function writeDb(db: StoreDatabase): void {
  ensureStorageReady();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function createToken(loginId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: loginId,
      exp: Date.now() + TOKEN_TTL_MS,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string | undefined): { valid: boolean; loginId?: string } {
  if (!token) return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };
    if (!decoded.sub || !decoded.exp || decoded.exp < Date.now()) {
      return { valid: false };
    }
    return { valid: true, loginId: decoded.sub };
  } catch {
    return { valid: false };
  }
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const verified = verifyToken(token);
  if (!verified.valid) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  next();
}

function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

// Connected SSE clients for instant Mobile -> PC updates
const sseClients = new Set<Response>();

function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function buildFolderSummaries(db: StoreDatabase) {
  return db.folders
    .map((folder) => {
      const folderPhotos = db.photos
        .filter((p) => p.folderId === folder.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const totalCompressedBytes = folderPhotos.reduce((acc, p) => acc + (p.compressedSize || 0), 0);
      const totalOriginalBytes = folderPhotos.reduce((acc, p) => acc + (p.originalSize || 0), 0);
      return {
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        photoCount: folderPhotos.length,
        totalCompressedBytes,
        totalOriginalBytes,
        coverPhotoId: folderPhotos[0]?.id ?? null,
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function startServer(): Promise<void> {
  ensureStorageReady();
  const app = express();

  app.use(express.json({ limit: '30mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth routes
  app.post('/api/auth/login', (req, res) => {
    const body = req.body as { loginId?: string; password?: string };
    const loginId = typeof body?.loginId === 'string' ? body.loginId.trim().toUpperCase() : '';
    const password = typeof body?.password === 'string' ? body.password.trim() : '';

    if (loginId !== VALID_LOGIN_ID || password !== VALID_PASSWORD) {
      res.status(401).json({ error: 'Invalid Login ID or Password.' });
      return;
    }

    const token = createToken(VALID_LOGIN_ID);
    res.json({ token, loginId: VALID_LOGIN_ID });
  });

  app.get('/api/auth/me', requireAuth, (_req, res) => {
    res.json({ authenticated: true, loginId: VALID_LOGIN_ID });
  });

  // SSE stream for real-time sync across Mobile & PC
  app.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // Folder routes
  app.get('/api/folders', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({ folders: buildFolderSummaries(db) });
  });

  app.post('/api/folders', requireAuth, (req, res) => {
    const body = req.body as { name?: string };
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) {
      res.status(400).json({ error: 'Folder name is required.' });
      return;
    }
    if (rawName.length > 80) {
      res.status(400).json({ error: 'Folder name must be 80 characters or fewer.' });
      return;
    }

    const db = readDb();
    const duplicate = db.folders.find((f) => f.name.toLowerCase() === rawName.toLowerCase());
    if (duplicate) {
      res.status(409).json({ error: 'A folder with this name already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const folder: FolderRecord = {
      id: crypto.randomUUID(),
      name: rawName,
      createdAt: now,
      updatedAt: now,
    };

    fs.mkdirSync(path.join(PHOTOS_DIR, folder.id), { recursive: true });
    db.folders.push(folder);
    writeDb(db);

    const summary = buildFolderSummaries(db).find((f) => f.id === folder.id);
    broadcastEvent('sync', { type: 'folder_created', folderId: folder.id });
    res.status(201).json({ folder: summary });
  });

  app.patch('/api/folders/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const body = req.body as { name?: string };
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) {
      res.status(400).json({ error: 'Folder name is required.' });
      return;
    }
    if (rawName.length > 80) {
      res.status(400).json({ error: 'Folder name must be 80 characters or fewer.' });
      return;
    }

    const db = readDb();
    const folder = db.folders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }

    const duplicate = db.folders.find(
      (f) => f.id !== id && f.name.toLowerCase() === rawName.toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: 'Another folder already uses that name.' });
      return;
    }

    folder.name = rawName;
    folder.updatedAt = new Date().toISOString();
    writeDb(db);

    const summary = buildFolderSummaries(db).find((f) => f.id === folder.id);
    broadcastEvent('sync', { type: 'folder_updated', folderId: folder.id });
    res.json({ folder: summary });
  });

  app.delete('/api/folders/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const index = db.folders.findIndex((f) => f.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }

    db.folders.splice(index, 1);
    db.photos = db.photos.filter((p) => p.folderId !== id);
    writeDb(db);

    const folderDir = path.join(PHOTOS_DIR, id);
    if (fs.existsSync(folderDir)) {
      fs.rmSync(folderDir, { recursive: true, force: true });
    }

    broadcastEvent('sync', { type: 'folder_deleted', folderId: id });
    res.json({ ok: true });
  });

  // Download entire folder as a ZIP archive for PC
  app.get('/api/folders/:id/download', requireAuth, async (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const folder = db.folders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }

    const folderPhotos = db.photos
      .filter((p) => p.folderId === id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (folderPhotos.length === 0) {
      res.status(400).json({ error: 'Folder has no photos to download.' });
      return;
    }

    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (let i = 0; i < folderPhotos.length; i++) {
      const photo = folderPhotos[i];
      const filePath = path.join(PHOTOS_DIR, folder.id, photo.diskName);
      if (!fs.existsSync(filePath)) continue;
      let entryName = photo.fileName;
      if (usedNames.has(entryName)) {
        const ext = path.extname(entryName);
        const base = path.basename(entryName, ext);
        entryName = `${base}_${i + 1}${ext}`;
      }
      usedNames.add(entryName);
      zip.file(entryName, fs.readFileSync(filePath));
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE', // Images are already optimally compressed
    });

    const safeZipName = sanitizeFileName(folder.name, 'folder') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeZipName}"`);
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  });

  // Photo routes
  app.get('/api/folders/:id/photos', requireAuth, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const folder = db.folders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }

    const photos = db.photos
      .filter((p) => p.folderId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((p) => ({
        id: p.id,
        folderId: p.folderId,
        fileName: p.fileName,
        mimeType: p.mimeType,
        originalSize: p.originalSize,
        compressedSize: p.compressedSize,
        width: p.width,
        height: p.height,
        qualityLabel: p.qualityLabel,
        createdAt: p.createdAt,
      }));

    res.json({ photos });
  });

  app.post('/api/folders/:id/photos', requireAuth, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const folder = db.folders.find((f) => f.id === id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }

    const body = req.body as {
      dataUrl?: string;
      fileName?: string;
      originalSize?: number;
      compressedSize?: number;
      width?: number;
      height?: number;
      mimeType?: string;
      qualityLabel?: string;
    };

    if (!body?.dataUrl || typeof body.dataUrl !== 'string') {
      res.status(400).json({ error: 'Image payload is required.' });
      return;
    }

    const match = body.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Invalid base64 image data.' });
      return;
    }

    const mimeType = match[1] === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const ext = mimeType === 'image/webp' ? '.webp' : '.jpg';
    const buffer = Buffer.from(match[2], 'base64');

    const photoId = crypto.randomUUID();
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `IMG_${stamp}${ext}`;
    const rawFileName = typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim()
      : defaultName;
    const safeDisplay = sanitizeFileName(rawFileName, defaultName);
    const finalDisplay = path.extname(safeDisplay) ? safeDisplay : `${safeDisplay}${ext}`;
    const diskName = `${photoId}${ext}`;

    const folderDir = path.join(PHOTOS_DIR, folder.id);
    fs.mkdirSync(folderDir, { recursive: true });
    fs.writeFileSync(path.join(folderDir, diskName), buffer);

    const photoRecord: PhotoRecord = {
      id: photoId,
      folderId: folder.id,
      fileName: finalDisplay,
      diskName,
      mimeType,
      originalSize: Number(body.originalSize) || buffer.length,
      compressedSize: buffer.length,
      width: Number(body.width) || 0,
      height: Number(body.height) || 0,
      qualityLabel: typeof body.qualityLabel === 'string' ? body.qualityLabel : 'Visually Lossless',
      createdAt: now.toISOString(),
    };

    db.photos.push(photoRecord);
    folder.updatedAt = now.toISOString();
    writeDb(db);

    broadcastEvent('sync', { type: 'photo_added', folderId: folder.id, photoId: photoRecord.id });

    res.status(201).json({
      photo: {
        id: photoRecord.id,
        folderId: photoRecord.folderId,
        fileName: photoRecord.fileName,
        mimeType: photoRecord.mimeType,
        originalSize: photoRecord.originalSize,
        compressedSize: photoRecord.compressedSize,
        width: photoRecord.width,
        height: photoRecord.height,
        qualityLabel: photoRecord.qualityLabel,
        createdAt: photoRecord.createdAt,
      },
    });
  });

  app.get('/api/photos/:photoId/file', requireAuth, (req, res) => {
    const { photoId } = req.params;
    const download = req.query.download === '1';
    const db = readDb();
    const photo = db.photos.find((p) => p.id === photoId);
    if (!photo) {
      res.status(404).json({ error: 'Photo not found.' });
      return;
    }

    const filePath = path.join(PHOTOS_DIR, photo.folderId, photo.diskName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Photo file missing from storage.' });
      return;
    }

    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${photo.fileName}"`);
    }
    res.sendFile(filePath);
  });

  app.delete('/api/photos/:photoId', requireAuth, (req, res) => {
    const { photoId } = req.params;
    const db = readDb();
    const index = db.photos.findIndex((p) => p.id === photoId);
    if (index === -1) {
      res.status(404).json({ error: 'Photo not found.' });
      return;
    }

    const [removed] = db.photos.splice(index, 1);
    const folder = db.folders.find((f) => f.id === removed.folderId);
    if (folder) {
      folder.updatedAt = new Date().toISOString();
    }
    writeDb(db);

    const filePath = path.join(PHOTOS_DIR, removed.folderId, removed.diskName);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }

    broadcastEvent('sync', { type: 'photo_deleted', folderId: removed.folderId, photoId });
    res.json({ ok: true });
  });

  // Frontend serving (Vite dev middleware in dev, static dist in production)
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StoreLens server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
