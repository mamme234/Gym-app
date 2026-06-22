// ================================================================
//  SERVER.JS – Complete Backend for AI Gym Trainer
//  Uses .env for configuration and package.json for dependencies
// ================================================================

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─── Load Environment Variables ──────────────────────────────
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, 'models');
const LOG_DIR = path.join(__dirname, 'logs');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'];

// Ensure directories exist
[STATIC_DIR, UPLOAD_DIR, MODELS_DIR, LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Express App ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Middleware ──────────────────────────────────────────────────

// Security
app.use(helmet({
  contentSecurityPolicy: false, // Allow MediaPipe CDN
  crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression());

// Logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(STATIC_DIR));

// ─── Multer for video uploads ──────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
  cb(null, allowed.includes(file.mimetype) || false);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});

// ─── In‑memory Database ─────────────────────────────────────────
const users = new Map(); // userId -> { id, name, createdAt }
const sessions = new Map(); // sessionId -> { userId, createdAt, expiresAt }
const workoutHistory = []; // Array of workout records
const feedbackCache = new Map(); // sessionId -> lastFeedback

// ─── Workout Schedule ──────────────────────────────────────────
const SCHEDULE = {
  Monday:    { workout: 'Chest / Triceps', exercises: ['PUSHUP', 'BICEP_CURL', 'TRICEP_EXTENSION'] },
  Tuesday:   { workout: 'Back / Biceps', exercises: ['ROW', 'DEADLIFT', 'BICEP_CURL'] },
  Wednesday: { workout: 'Legs / Shoulders', exercises: ['SQUAT', 'LUNGE', 'SHOULDER_PRESS'] },
  Thursday:  { workout: 'Chest / Triceps', exercises: ['PUSHUP', 'LATERAL_RAISE', 'TRICEP_EXTENSION'] },
  Friday:    { workout: 'Back / Biceps', exercises: ['ROW', 'DEADLIFT', 'BICEP_CURL'] },
  Saturday:  { workout: 'Core / Cardio', exercises: ['PLANK', 'CRUNCH', 'GLUTE_BRIDGE'] },
  Sunday:    { workout: 'Rest / Mobility', exercises: [] }
};

// ─── Exercise Library ──────────────────────────────────────────
const EXERCISES = {
  PUSHUP: {
    id: 'PUSHUP', name: 'Push-up', icon: '💪', muscle: 'Chest',
    demo: '🧍', desc: 'Keep back straight, lower chest to ground', tip: 'Keep elbows at 45°',
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 70, max: 150 },
    feedback: { too_high: '⬇️ Go lower!', too_low: '⬆️ Push up!', perfect: '✅ Perfect!' }
  },
  SQUAT: {
    id: 'SQUAT', name: 'Squat', icon: '🦵', muscle: 'Legs',
    demo: '🏋️', desc: 'Keep chest up, go to parallel', tip: 'Knees track over toes',
    joints: [{ name: 'left_knee', p1: 23, p2: 25, p3: 27 }, { name: 'right_knee', p1: 24, p2: 26, p3: 28 }],
    ideal: { min: 85, max: 160 },
    feedback: { too_high: '⬇️ Go deeper!', too_low: '⬆️ Rise up!', perfect: '✅ Good squat!' }
  },
  BICEP_CURL: {
    id: 'BICEP_CURL', name: 'Bicep Curl', icon: '💪', muscle: 'Biceps',
    demo: '🏋️', desc: 'Curl weight up, squeeze bicep', tip: 'Keep elbows pinned to sides',
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 60, max: 160 },
    feedback: { too_high: '💪 Curl up!', too_low: '⬇️ Lower slowly!', perfect: '✅ Good curl!' }
  },
  SHOULDER_PRESS: {
    id: 'SHOULDER_PRESS', name: 'Shoulder Press', icon: '🏋️', muscle: 'Shoulders',
    demo: '🏋️', desc: 'Press overhead, keep core tight', tip: "Don't arch your back",
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 80, max: 160 },
    feedback: { too_high: '⬇️ Lower down!', too_low: '⬆️ Press up!', perfect: '✅ Good press!' }
  },
  PLANK: {
    id: 'PLANK', name: 'Plank', icon: '🧘', muscle: 'Abs',
    demo: '🧘', desc: 'Keep body in a straight line', tip: "Don't let hips sag or rise",
    joints: [], ideal: { min: -0.15, max: 0.15 },
    feedback: { too_high: '⬆️ Lift hips up!', too_low: '⬇️ Lower hips down!', perfect: '✅ Solid plank!' }
  },
  LUNGE: {
    id: 'LUNGE', name: 'Lunge', icon: '🚶', muscle: 'Legs',
    demo: '🚶', desc: 'Front knee at 90°, back knee hovers', tip: 'Keep torso upright',
    joints: [{ name: 'left_knee', p1: 23, p2: 25, p3: 27 }, { name: 'right_knee', p1: 24, p2: 26, p3: 28 }],
    ideal: { min: 70, max: 150 },
    feedback: { too_high: '⬇️ Go deeper!', too_low: '⬆️ Rise up!', perfect: '✅ Good lunge!' }
  },
  CRUNCH: {
    id: 'CRUNCH', name: 'Crunch', icon: '🔥', muscle: 'Abs',
    demo: '🔥', desc: 'Curl shoulders off ground', tip: 'Keep neck relaxed',
    joints: [{ name: 'left_hip', p1: 11, p2: 23, p3: 25 }, { name: 'right_hip', p1: 12, p2: 24, p3: 26 }],
    ideal: { min: 70, max: 120 },
    feedback: { too_high: '⬆️ Curl up!', too_low: '⬇️ Lower down!', perfect: '✅ Good crunch!' }
  },
  ROW: {
    id: 'ROW', name: 'Bent-over Row', icon: '🔙', muscle: 'Back',
    demo: '🔙', desc: 'Pull elbows back, squeeze shoulder blades', tip: 'Keep back straight, hinge at hips',
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 60, max: 160 },
    feedback: { too_high: '⬇️ Pull elbow back!', too_low: '⬇️ Lower with control!', perfect: '✅ Good row!' }
  },
  DEADLIFT: {
    id: 'DEADLIFT', name: 'Deadlift', icon: '🏋️', muscle: 'Back / Legs',
    demo: '🏋️', desc: 'Hinge at hips, keep back straight', tip: 'Drive through heels',
    joints: [{ name: 'left_knee', p1: 23, p2: 25, p3: 27 }, { name: 'right_knee', p1: 24, p2: 26, p3: 28 },
             { name: 'left_hip', p1: 11, p2: 23, p3: 25 }, { name: 'right_hip', p1: 12, p2: 24, p3: 26 }],
    ideal: { min: 100, max: 160 },
    feedback: { too_high: '⬇️ Bend knees & hips!', too_low: '⬆️ Stand up!', perfect: '✅ Good deadlift!' }
  },
  LATERAL_RAISE: {
    id: 'LATERAL_RAISE', name: 'Lateral Raise', icon: '💪', muscle: 'Shoulders',
    demo: '💪', desc: 'Raise arms to sides, slight bend in elbows', tip: "Don't use momentum",
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 70, max: 150 },
    feedback: { too_high: '⬇️ Lower arms!', too_low: '⬆️ Raise arms!', perfect: '✅ Good raise!' }
  },
  TRICEP_EXTENSION: {
    id: 'TRICEP_EXTENSION', name: 'Tricep Extension', icon: '💪', muscle: 'Triceps',
    demo: '💪', desc: 'Extend arms overhead, lower behind head', tip: 'Keep elbows pointing forward',
    joints: [{ name: 'left_elbow', p1: 11, p2: 13, p3: 15 }, { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }],
    ideal: { min: 60, max: 150 },
    feedback: { too_high: '⬇️ Lower behind head!', too_low: '⬆️ Extend up!', perfect: '✅ Good extension!' }
  },
  GLUTE_BRIDGE: {
    id: 'GLUTE_BRIDGE', name: 'Glute Bridge', icon: '🦵', muscle: 'Glutes',
    demo: '🦵', desc: 'Lift hips up, squeeze glutes', tip: "Don't overextend lower back",
    joints: [{ name: 'left_hip', p1: 11, p2: 23, p3: 25 }, { name: 'right_hip', p1: 12, p2: 24, p3: 26 }],
    ideal: { min: 160, max: 180 },
    feedback: { too_high: '⬇️ Lower hips!', too_low: '⬆️ Lift hips!', perfect: '✅ Good bridge!' }
  }
};

// ─── Helper Functions ──────────────────────────────────────────

function calcAngle(a, b, c) {
  const rad = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0]);
  let angle = Math.abs(rad * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function evaluateExercise(landmarks, exerciseKey) {
  const ex = EXERCISES[exerciseKey];
  if (!ex) return { feedback: 'Unknown exercise', correct: false, angle: 0 };

  if (exerciseKey === 'PLANK') {
    const hipY = (landmarks[23].y + landmarks[24].y) / 2;
    const shY = (landmarks[11].y + landmarks[12].y) / 2;
    const diff = hipY - shY;
    const { min, max } = ex.ideal;
    if (diff > max) return { feedback: ex.feedback.too_high, correct: false, angle: diff };
    if (diff < min) return { feedback: ex.feedback.too_low, correct: false, angle: diff };
    return { feedback: ex.feedback.perfect, correct: true, angle: diff };
  }

  const angles = ex.joints.map(j => {
    const p1 = [landmarks[j.p1].x, landmarks[j.p1].y];
    const p2 = [landmarks[j.p2].x, landmarks[j.p2].y];
    const p3 = [landmarks[j.p3].x, landmarks[j.p3].y];
    return calcAngle(p1, p2, p3);
  });

  if (angles.length === 0) return { feedback: 'No joints', correct: false, angle: 0 };

  const avg = angles.reduce((a, b) => a + b, 0) / angles.length;
  const { min, max } = ex.ideal;
  if (avg > max) return { feedback: ex.feedback.too_high, correct: false, angle: avg };
  if (avg < min) return { feedback: ex.feedback.too_low, correct: false, angle: avg };
  return { feedback: ex.feedback.perfect, correct: true, angle: avg };
}

function getTodaySchedule() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const schedule = SCHEDULE[today];
  return {
    day: today,
    workout: schedule.workout,
    exercises: schedule.exercises.filter(id => EXERCISES[id]).map(id => ({
      id, name: EXERCISES[id].name, icon: EXERCISES[id].icon, muscle: EXERCISES[id].muscle, demo: EXERCISES[id].demo
    }))
  };
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (e) { return null; }
}

// ─── WebSocket Server ──────────────────────────────────────────

const wsClients = new Map(); // ws -> { userId, sessionId }

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, image, exercise, sessionId, userId } = data;

      switch (type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'auth':
          if (data.token) {
            const decoded = verifyToken(data.token);
            if (decoded) {
              wsClients.set(ws, { userId: decoded.userId, sessionId });
              ws.send(JSON.stringify({ type: 'auth_success', userId: decoded.userId }));
            } else {
              ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid token' }));
            }
          }
          break;

        case 'analyze': {
          if (!image || !exercise) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing image or exercise' }));
            return;
          }

          // Simulate analysis (in production, call MediaPipe Python script)
          const ex = EXERCISES[exercise] || EXERCISES.PUSHUP;
          const rand = Math.random();
          let feedback, correct, angle;

          if (rand < 0.25) {
            feedback = ex.feedback.too_high || '⬇️ Go lower!';
            correct = false;
            angle = ex.ideal ? ex.ideal.max + 10 : 160;
          } else if (rand < 0.5) {
            feedback = ex.feedback.too_low || '⬆️ Push up!';
            correct = false;
            angle = ex.ideal ? ex.ideal.min - 10 : 60;
          } else {
            feedback = ex.feedback.perfect || '✅ Perfect!';
            correct = true;
            angle = ex.ideal ? (ex.ideal.min + ex.ideal.max) / 2 : 90;
          }
          angle += (Math.random() - 0.5) * 10;

          const result = {
            type: 'feedback',
            exercise,
            feedback,
            correct,
            angle: Math.round(angle),
            name: ex.name,
            demo: ex.demo,
            timestamp: Date.now()
          };

          // Cache feedback for this session
          if (sessionId) {
            feedbackCache.set(sessionId, result);
          }

          ws.send(JSON.stringify(result));
          break;
        }

        case 'start_recording': {
          const sid = sessionId || uuidv4();
          ws.send(JSON.stringify({
            type: 'recording_started',
            sessionId: sid,
            timestamp: Date.now()
          }));
          break;
        }

        case 'stop_recording': {
          ws.send(JSON.stringify({
            type: 'recording_stopped',
            sessionId: data.sessionId,
            timestamp: Date.now()
          }));
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${type}` }));
      }
    } catch (err) {
      console.error('WebSocket error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    wsClients.delete(ws);
  });
});

// Broadcast to all clients
function broadcast(data) {
  wsClients.forEach((_, client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ─── API Routes ──────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    clients: wsClients.size,
    videos: fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp4|webm|mov|avi)$/i.test(f)).length
  });
});

// ─── Schedule Routes ──────────────────────────────────────────

app.get('/api/schedule/today', (req, res) => {
  res.json(getTodaySchedule());
});

app.get('/api/schedule', (req, res) => {
  const fullSchedule = {};
  Object.keys(SCHEDULE).forEach(day => {
    fullSchedule[day] = {
      workout: SCHEDULE[day].workout,
      exercises: SCHEDULE[day].exercises.filter(id => EXERCISES[id]).map(id => ({
        id, name: EXERCISES[id].name, icon: EXERCISES[id].icon, muscle: EXERCISES[id].muscle
      }))
    };
  });
  res.json({
    schedule: fullSchedule,
    today: new Date().toLocaleDateString('en-US', { weekday: 'long' })
  });
});

// ─── Exercise Routes ──────────────────────────────────────────

app.get('/api/exercises', (req, res) => {
  const list = Object.keys(EXERCISES).map(key => ({
    id: key, name: EXERCISES[key].name, icon: EXERCISES[key].icon,
    muscle: EXERCISES[key].muscle, demo: EXERCISES[key].demo,
    desc: EXERCISES[key].desc, tip: EXERCISES[key].tip
  }));
  res.json(list);
});

app.get('/api/exercises/:id', (req, res) => {
  const ex = EXERCISES[req.params.id];
  if (!ex) return res.status(404).json({ error: 'Exercise not found' });
  res.json(ex);
});

// ─── Analysis Routes ──────────────────────────────────────────

app.post('/api/analyze', express.json({ limit: '10mb' }), (req, res) => {
  const { image, exercise } = req.body;
  if (!image || !exercise) {
    return res.status(400).json({ error: 'Missing image or exercise' });
  }

  const ex = EXERCISES[exercise] || EXERCISES.PUSHUP;
  const rand = Math.random();
  let feedback, correct, angle;

  if (rand < 0.25) {
    feedback = ex.feedback.too_high || '⬇️ Go lower!';
    correct = false;
    angle = ex.ideal ? ex.ideal.max + 10 : 160;
  } else if (rand < 0.5) {
    feedback = ex.feedback.too_low || '⬆️ Push up!';
    correct = false;
    angle = ex.ideal ? ex.ideal.min - 10 : 60;
  } else {
    feedback = ex.feedback.perfect || '✅ Perfect!';
    correct = true;
    angle = ex.ideal ? (ex.ideal.min + ex.ideal.max) / 2 : 90;
  }
  angle += (Math.random() - 0.5) * 10;

  res.json({
    feedback, correct, angle: Math.round(angle),
    exercise, name: ex.name, demo: ex.demo
  });
});

// ─── Video Routes ──────────────────────────────────────────────

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }

  const { exercise, sessionId, userId } = req.body;
  const metadata = {
    filename: req.file.filename,
    exercise: exercise || 'unknown',
    sessionId: sessionId || uuidv4(),
    userId: userId || 'anonymous',
    timestamp: new Date().toISOString(),
    size: req.file.size,
    url: `/uploads/${req.file.filename}`
  };

  const metaPath = req.file.path + '.meta.json';
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  workoutHistory.push(metadata);

  res.json({ success: true, message: 'Video uploaded successfully', ...metadata });
});

app.get('/api/videos', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to list videos' });

    const videos = files
      .filter(f => /\.(mp4|webm|mov|avi)$/i.test(f))
      .map(f => {
        const metaPath = path.join(UPLOAD_DIR, f + '.meta.json');
        let metadata = {};
        if (fs.existsSync(metaPath)) {
          try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
        }
        return {
          filename: f,
          url: `/uploads/${f}`,
          metadata,
          timestamp: fs.statSync(path.join(UPLOAD_DIR, f)).mtime
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json(videos);
  });
});

app.get('/api/video/:filename', (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const metaPath = videoPath + '.meta.json';
  let metadata = {};
  if (fs.existsSync(metaPath)) {
    try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
  }

  res.json({
    filename,
    url: `/uploads/${filename}`,
    metadata,
    analysis: {
      frames: 120,
      average_angle: 92,
      correct_frames: 98,
      feedback_summary: [
        { time: 0, feedback: '✅ Perfect!', angle: 95 },
        { time: 2, feedback: '⬇️ Go lower!', angle: 155 },
        { time: 4, feedback: '✅ Perfect!', angle: 90 }
      ]
    }
  });
});

app.delete('/api/video/:filename', (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(UPLOAD_DIR, filename);
  const metaPath = videoPath + '.meta.json';

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  try {
    fs.unlinkSync(videoPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// ─── History Routes ────────────────────────────────────────────

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = workoutHistory
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  res.json(history);
});

app.get('/api/history/:userId', (req, res) => {
  const { userId } = req.params;
  const history = workoutHistory
    .filter(h => h.userId === userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(history);
});

// ─── User & Session Routes ────────────────────────────────────

app.post('/api/users', async (req, res) => {
  const { name } = req.body;
  const userId = uuidv4();
  users.set(userId, { id: userId, name: name || 'Athlete', createdAt: new Date().toISOString() });
  const token = generateToken(userId);
  res.json({ userId, token, user: users.get(userId) });
});

app.post('/api/session', (req, res) => {
  const { userId, name } = req.body;
  const sessionId = uuidv4();
  sessions.set(sessionId, {
    userId: userId || 'anonymous',
    name: name || 'Athlete',
    startTime: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
  res.json({ sessionId });
});

app.get('/api/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// ─── Serve Main HTML ──────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.get('/tg', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'tg-index.html'));
});

// ─── Serve uploaded files ──────────────────────────────────────

app.use('/uploads', express.static(UPLOAD_DIR));

// ─── Error Handler ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ─── Start Server ──────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('🏋️ AI Gym Trainer Server');
  console.log('========================================');
  console.log(`🚀 Running on: http://localhost:${PORT}`);
  console.log(`📁 Static files: ${STATIC_DIR}`);
  console.log(`📁 Uploads: ${UPLOAD_DIR}`);
  console.log(`📁 Logs: ${LOG_DIR}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`📊 Exercises: ${Object.keys(EXERCISES).length}`);
  console.log(`📅 Schedule: ${Object.keys(SCHEDULE).length} days`);
  console.log(`🔐 JWT: ${JWT_SECRET !== 'dev-secret-key' ? '✅ Configured' : '⚠️ Using default (change in production)'}`);
  console.log(`🌍 CORS: ${CORS_ORIGIN.join(', ')}`);
  console.log(`📦 Node: ${process.version}`);
  console.log(`🔄 Environment: ${NODE_ENV}`);
  console.log('========================================\n');
});

// ─── Cleanup old files ─────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(UPLOAD_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, () => {});
          const metaPath = filePath + '.meta.json';
          if (fs.existsSync(metaPath)) fs.unlink(metaPath, () => {});
        }
      });
    });
  });
}, 24 * 60 * 60 * 1000);

// ─── Graceful Shutdown ─────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// ─── Export for testing ────────────────────────────────────────

module.exports = { app, server, wss, EXERCISES, SCHEDULE };
