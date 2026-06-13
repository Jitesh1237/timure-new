require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const fs = require('fs');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 5000;

// Data directory - use DATA_DIR env var if set (for Render/Railway volume mount), otherwise use server directory
function getDataDir() {
  const envDir = process.env.DATA_DIR;
  if (envDir) {
    try {
      if (!fs.existsSync(envDir)) {
        fs.mkdirSync(envDir, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(envDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log(`📁 Using DATA_DIR: ${envDir}`);
      return envDir;
    } catch (err) {
      console.warn(`⚠️  DATA_DIR (${envDir}) is not writable: ${err.message}. Falling back to server directory.`);
    }
  }
  return __dirname;
}
const DATA_DIR = getDataDir();

// Base URL for generating full image URLs (needed when frontend is on a different domain)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Helper to convert relative upload path to full URL
function toFullUrl(relativePath) {
  if (!relativePath) return relativePath;
  if (relativePath.startsWith('http')) return relativePath;
  return `${BASE_URL}${relativePath}`;
}

// JWT Secret - MUST be set via environment variable in production
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET environment variable not set! Using a weak default secret. Set JWT_SECRET in production!');
}
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-timure-yatayat-2024';

// Ensure uploads directory exists
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Database setup
const db = new Database(path.join(DATA_DIR, 'database.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    caption TEXT,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword);
  console.log('⚠️  Default admin user created (username: admin, password: admin123)');
  console.log('⚠️  CHANGE THE DEFAULT PASSWORD IMMEDIATELY via the Admin Panel!');
}

// Seed default gallery images if empty
const galleryCount = db.prepare('SELECT COUNT(*) as count FROM gallery').get();
if (galleryCount.count === 0) {
  const defaultImages = [
    { title: 'Kathmandu City View', caption: 'Scenic view of Kathmandu valley', image_url: '/api/placeholder/800/500' },
    { title: 'Mountain Highway', caption: 'The beautiful mountain roads of Nepal', image_url: '/api/placeholder/800/500' },
    { title: 'Timure Bus Terminal', caption: 'Our modern bus fleet at the terminal', image_url: '/api/placeholder/800/500' },
    { title: 'Langtang Valley', caption: 'Gateway to Langtang through Timure', image_url: '/api/placeholder/800/500' },
    { title: 'Rasuwagadhi Border', caption: 'Nepal-China border crossing point', image_url: '/api/placeholder/800/500' },
    { title: 'Passenger Comfort', caption: 'AC coaches with comfortable seating', image_url: '/api/placeholder/800/500' },
  ];
  const insertGallery = db.prepare('INSERT INTO gallery (title, caption, image_url, sort_order) VALUES (?, ?, ?, ?)');
  defaultImages.forEach((img, idx) => {
    insertGallery.run(img.title, img.caption, img.image_url, idx);
  });
  console.log('Default gallery images seeded');
}

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for SVG placeholder images
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir));

// Serve static frontend files (React build)
const clientDistPath = fs.existsSync(path.join(__dirname, '../client/dist'))
  ? path.join(__dirname, '../client/dist')
  : path.join(__dirname, '../dist');
app.use(express.static(clientDistPath));

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ==================== AUTH ROUTES ====================

// Login (with rate limiting)
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

// Change password
app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);
  res.json({ message: 'Password changed successfully' });
});

// ==================== UPLOAD ROUTE ====================

// Helper: resize image to 800x500 and return the filename
async function resizeImage(filePath) {
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const resizedName = baseName + '-800x500.jpg';
  const resizedPath = path.join(uploadsDir, resizedName);
  await sharp(filePath)
    .resize(800, 500, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(resizedPath);
  // Remove original if different from resized
  if (filePath !== resizedPath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return resizedName;
}

// Upload an image, resize to 800x500, and return its URL
app.post('/api/upload', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }
  try {
    const resizedFilename = await resizeImage(req.file.path);
    const imageUrl = toFullUrl(`/uploads/${resizedFilename}`);
    res.json({ url: imageUrl });
  } catch (err) {
    console.error('Image resize error:', err);
    // Fallback: return original file URL if resize fails
    const imageUrl = toFullUrl(`/uploads/${req.file.filename}`);
    res.json({ url: imageUrl });
  }
});

// ==================== GALLERY ROUTES ====================

// Get all gallery images (public)
app.get('/api/gallery', (req, res) => {
  const images = db.prepare('SELECT * FROM gallery WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC').all();
  // Ensure image URLs are full URLs for cross-origin access
  res.json(images.map(img => ({ ...img, image_url: toFullUrl(img.image_url) })));
});

// Get all gallery images including inactive (admin)
app.get('/api/gallery/all', authMiddleware, (req, res) => {
  const images = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, created_at DESC').all();
  res.json(images.map(img => ({ ...img, image_url: toFullUrl(img.image_url) })));
});

// Upload and create gallery image
app.post('/api/gallery', authMiddleware, upload.single('image'), async (req, res) => {
  const { title, caption, sort_order, is_active } = req.body;

  let image_url;
  if (req.file) {
    try {
      const resizedFilename = await resizeImage(req.file.path);
      image_url = `/uploads/${resizedFilename}`;
    } catch (err) {
      console.error('Image resize error:', err);
      image_url = `/uploads/${req.file.filename}`;
    }
  } else if (req.body.image_url) {
    image_url = req.body.image_url;
  } else {
    return res.status(400).json({ error: 'Image file or URL is required' });
  }

  const result = db.prepare(
    'INSERT INTO gallery (title, caption, image_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?)'
  ).run(title, caption || '', image_url, sort_order || 0, is_active !== undefined ? is_active : 1);

  const newImage = db.prepare('SELECT * FROM gallery WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...newImage, image_url: toFullUrl(newImage.image_url) });
});

// Update gallery image
app.put('/api/gallery/:id', authMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { title, caption, sort_order, is_active } = req.body;

  const existing = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Image not found' });

  let image_url = existing.image_url;
  if (req.file) {
    // Delete old file if it's a local upload
    if (existing.image_url.startsWith('/uploads/')) {
      const oldPath = path.join(DATA_DIR, existing.image_url.replace('/uploads/', ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    try {
      const resizedFilename = await resizeImage(req.file.path);
      image_url = `/uploads/${resizedFilename}`;
    } catch (err) {
      console.error('Image resize error:', err);
      image_url = `/uploads/${req.file.filename}`;
    }
  } else if (req.body.image_url) {
    image_url = req.body.image_url;
  }

  db.prepare(
    'UPDATE gallery SET title = ?, caption = ?, image_url = ?, sort_order = ?, is_active = ? WHERE id = ?'
  ).run(
    title || existing.title,
    caption !== undefined ? caption : existing.caption,
    image_url,
    sort_order !== undefined ? sort_order : existing.sort_order,
    is_active !== undefined ? is_active : existing.is_active,
    id
  );

  const updated = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id);
  res.json({ ...updated, image_url: toFullUrl(updated.image_url) });
});

// Delete gallery image
app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Image not found' });

  // Delete file if local upload
  if (existing.image_url.startsWith('/uploads/')) {
    const filePath = path.join(DATA_DIR, existing.image_url.replace('/uploads/', ''));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  res.json({ message: 'Image deleted successfully' });
});

// Reorder gallery images
app.put('/api/gallery-reorder', authMiddleware, (req, res) => {
  const { order } = req.body; // Array of { id, sort_order }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order array required' });

  const update = db.prepare('UPDATE gallery SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction((items) => {
    items.forEach(item => update.run(item.sort_order, item.id));
  });
  transaction(order);

  res.json({ message: 'Reorder successful' });
});

// ==================== SITE SETTINGS ROUTES ====================

// Get all settings
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM site_settings').all();
  const obj = {};
  settings.forEach(s => obj[s.key] = s.value);
  res.json(obj);
});

// Update settings (admin)
app.put('/api/settings', authMiddleware, (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object required' });
  }

  const upsert = db.prepare(`
    INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((entries) => {
    entries.forEach(([key, value]) => upsert.run(key, value));
  });
  transaction(Object.entries(settings));

  res.json({ message: 'Settings updated' });
});

// ==================== PLACEHOLDER IMAGE ====================
app.get('/api/placeholder/:width/:height', (req, res) => {
  const { width, height } = req.params;
  const w = parseInt(width) || 800;
  const h = parseInt(height) || 500;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1a1a2e"/>
    <text x="50%" y="45%" text-anchor="middle" fill="#f4b43d" font-family="sans-serif" font-size="24" font-weight="bold">TIMURE YATAYAT</text>
    <text x="50%" y="55%" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14">${w}×${h}</text>
    <rect x="0" y="0" width="${w}" height="4" fill="#d81f26"/>
    <rect x="0" height="4" y="${h - 4}" width="${w}" fill="#0b6b3a"/>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// ==================== SPA FALLBACK ====================
app.get('*', (req, res) => {
  // In API-only mode (Render backend), no client dist exists — return JSON
  const indexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found. This is an API-only server.' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚌 Timure Yatayat server running on http://localhost:${PORT}`);
  console.log(`📸 Gallery API: http://localhost:${PORT}/api/gallery`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin.html`);
});
