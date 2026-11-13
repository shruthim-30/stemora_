
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./config/db');
const enquiryRoutes = require('./routes/enquiryRoutes');
const contentRoutes = require('./routes/contentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminAuth = require('./middleware/adminAuth');

const app = express();

// Trust proxy for cPanel / reverse proxy deployments (for correct HTTPS / cookie detection)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Locate React production build across common deployment layouts
function resolveClientBuildPath() {
  const candidates = [
    process.env.CLIENT_BUILD_DIR,
    path.join(__dirname, '..', 'client', 'dist'),
    path.join(__dirname, 'public'),
    path.join(__dirname, 'dist')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return candidates[0] || path.join(__dirname, '..', 'client', 'dist');
}

const clientBuildPath = resolveClientBuildPath();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api/admin', adminRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/api/health', async (req, res, next) => {
  try {
    const database = await db.healthCheck();
    res.status(200).json({
      status: 'online',
      timestamp: new Date().toISOString(),
      service: 'Stemora Dynamic API',
      version: '1.0.0',
      database
    });
  } catch (error) {
    next(error);
  }
});

// Serve React production build
if (fs.existsSync(clientBuildPath)) {
  console.log('[SERVER] Serving React production build from:', clientBuildPath);

  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      path.extname(req.path) ||
      !req.accepts('html')
    ) return res.sendStatus(404);

    return res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.error('[SERVER] React production build not found:', clientBuildPath);
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack || err);

  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    success: false,
    error: status < 500 ? err.message : 'Internal Server Error'
  });
});

// Start server
async function startServer() {
  try {
    if (process.env.NODE_ENV === 'production') {
      try {
        adminAuth.assertAdminConfig();
      } catch (authErr) {
        console.warn('[SERVER WARNING] Admin config notice:', authErr.message);
      }
      if (!fs.existsSync(path.join(clientBuildPath, 'index.html'))) {
        console.warn(`[SERVER WARNING] React production build not found at: ${clientBuildPath}`);
      }
    }

    await db.init();

    fs.mkdirSync(uploadDir, { recursive: true });
    app.listen(PORT, () => {
      console.log('===============================================');
      console.log('[SERVER] Stemora Backend running');
      console.log('[SERVER] Port:', PORT);
      console.log(`[SERVER] API Health: /api/health`);
      console.log('===============================================');
    });

  } catch (error) {
    console.error('[SERVER STARTUP ERROR]', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
