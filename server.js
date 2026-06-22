// ================================================================
//  SERVER.JS – Complete Backend for AI Gym Trainer
//  Supports: Schedule, Exercise Library, Video Recording,
//  Real‑time Feedback (WebSocket), Form Analysis,
//  and Telegram Mini App integration.
// ================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const { spawn } = require('child_process');

// ─── Configuration ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MODELS_DIR = path.join(__dirname, 'models');

// Ensure directories exist
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// ─── Express App ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
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
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    cb(null, allowed.includes(file.mimetype) || true);
  }
});

// ─── In‑memory Database ─────────────────────────────────────────
// User sessions
const sessions = new Map();

// Workout history
const workoutHistory = [];

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

// ─── Exercise Library (Full) ──────────────────────────────────
const EXERCISES = {
  PUSHUP: {
    id: 'PUSHUP',
    name: 'Push-up',
    icon: '💪',
    muscle: 'Chest',
    demo: '🧍',
    desc: 'Keep back straight, lower chest to ground',
    tip: 'Keep elbows at 45°',
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 70, max: 150 },
    feedback: {
      too_high: '⬇️ Go lower!',
      too_low: '⬆️ Push up!',
      perfect: '✅ Perfect!'
    }
  },
  SQUAT: {
    id: 'SQUAT',
    name: 'Squat',
    icon: '🦵',
    muscle: 'Legs',
    demo: '🏋️',
    desc: 'Keep chest up, go to parallel',
    tip: 'Knees track over toes',
    joints: [
      { name: 'left_knee', p1: 23, p2: 25, p3: 27 },
      { name: 'right_knee', p1: 24, p2: 26, p3: 28 }
    ],
    ideal: { min: 85, max: 160 },
    feedback: {
      too_high: '⬇️ Go deeper!',
      too_low: '⬆️ Rise up!',
      perfect: '✅ Good squat!'
    }
  },
  BICEP_CURL: {
    id: 'BICEP_CURL',
    name: 'Bicep Curl',
    icon: '💪',
    muscle: 'Biceps',
    demo: '🏋️',
    desc: 'Curl weight up, squeeze bicep',
    tip: 'Keep elbows pinned to sides',
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 60, max: 160 },
    feedback: {
      too_high: '💪 Curl up!',
      too_low: '⬇️ Lower slowly!',
      perfect: '✅ Good curl!'
    }
  },
  SHOULDER_PRESS: {
    id: 'SHOULDER_PRESS',
    name: 'Shoulder Press',
    icon: '🏋️',
    muscle: 'Shoulders',
    demo: '🏋️',
    desc: 'Press overhead, keep core tight',
    tip: "Don't arch your back",
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 80, max: 160 },
    feedback: {
      too_high: '⬇️ Lower down!',
      too_low: '⬆️ Press up!',
      perfect: '✅ Good press!'
    }
  },
  PLANK: {
    id: 'PLANK',
    name: 'Plank',
    icon: '🧘',
    muscle: 'Abs',
    demo: '🧘',
    desc: 'Keep body in a straight line',
    tip: "Don't let hips sag or rise",
    joints: [],
    ideal: { min: -0.15, max: 0.15 },
    feedback: {
      too_high: '⬆️ Lift hips up!',
      too_low: '⬇️ Lower hips down!',
      perfect: '✅ Solid plank!'
    }
  },
  LUNGE: {
    id: 'LUNGE',
    name: 'Lunge',
    icon: '🚶',
    muscle: 'Legs',
    demo: '🚶',
    desc: 'Front knee at 90°, back knee hovers',
    tip: 'Keep torso upright',
    joints: [
      { name: 'left_knee', p1: 23, p2: 25, p3: 27 },
      { name: 'right_knee', p1: 24, p2: 26, p3: 28 }
    ],
    ideal: { min: 70, max: 150 },
    feedback: {
      too_high: '⬇️ Go deeper!',
      too_low: '⬆️ Rise up!',
      perfect: '✅ Good lunge!'
    }
  },
  CRUNCH: {
    id: 'CRUNCH',
    name: 'Crunch',
    icon: '🔥',
    muscle: 'Abs',
    demo: '🔥',
    desc: 'Curl shoulders off ground',
    tip: 'Keep neck relaxed',
    joints: [
      { name: 'left_hip', p1: 11, p2: 23, p3: 25 },
      { name: 'right_hip', p1: 12, p2: 24, p3: 26 }
    ],
    ideal: { min: 70, max: 120 },
    feedback: {
      too_high: '⬆️ Curl up!',
      too_low: '⬇️ Lower down!',
      perfect: '✅ Good crunch!'
    }
  },
  ROW: {
    id: 'ROW',
    name: 'Bent-over Row',
    icon: '🔙',
    muscle: 'Back',
    demo: '🔙',
    desc: 'Pull elbows back, squeeze shoulder blades',
    tip: 'Keep back straight, hinge at hips',
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 60, max: 160 },
    feedback: {
      too_high: '⬇️ Pull elbow back!',
      too_low: '⬇️ Lower with control!',
      perfect: '✅ Good row!'
    }
  },
  DEADLIFT: {
    id: 'DEADLIFT',
    name: 'Deadlift',
    icon: '🏋️',
    muscle: 'Back / Legs',
    demo: '🏋️',
    desc: 'Hinge at hips, keep back straight',
    tip: 'Drive through heels',
    joints: [
      { name: 'left_knee', p1: 23, p2: 25, p3: 27 },
      { name: 'right_knee', p1: 24, p2: 26, p3: 28 },
      { name: 'left_hip', p1: 11, p2: 23, p3: 25 },
      { name: 'right_hip', p1: 12, p2: 24, p3: 26 }
    ],
    ideal: { min: 100, max: 160 },
    feedback: {
      too_high: '⬇️ Bend knees & hips!',
      too_low: '⬆️ Stand up!',
      perfect: '✅ Good deadlift!'
    }
  },
  LATERAL_RAISE: {
    id: 'LATERAL_RAISE',
    name: 'Lateral Raise',
    icon: '💪',
    muscle: 'Shoulders',
    demo: '💪',
    desc: 'Raise arms to sides, slight bend in elbows',
    tip: "Don't use momentum",
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 70, max: 150 },
    feedback: {
      too_high: '⬇️ Lower arms!',
      too_low: '⬆️ Raise arms!',
      perfect: '✅ Good raise!'
    }
  },
  TRICEP_EXTENSION: {
    id: 'TRICEP_EXTENSION',
    name: 'Tricep Extension',
    icon: '💪',
    muscle: 'Triceps',
    demo: '💪',
    desc: 'Extend arms overhead, lower behind head',
    tip: 'Keep elbows pointing forward',
    joints: [
      { name: 'left_elbow', p1: 11, p2: 13, p3: 15 },
      { name: 'right_elbow', p1: 12, p2: 14, p3: 16 }
    ],
    ideal: { min: 60, max: 150 },
    feedback: {
      too_high: '⬇️ Lower behind head!',
      too_low: '⬆️ Extend up!',
      perfect: '✅ Good extension!'
    }
  },
  GLUTE_BRIDGE: {
    id: 'GLUTE_BRIDGE',
    name: 'Glute Bridge',
    icon: '🦵',
    muscle: 'Glutes',
    demo: '🦵',
    desc: 'Lift hips up, squeeze glutes',
    tip: "Don't overextend lower back",
    joints: [
      { name: 'left_hip', p1: 11, p2: 23, p3: 25 },
      { name: 'right_hip', p1: 12, p2: 24, p3: 26 }
    ],
    ideal: { min: 160, max: 180 },
    feedback: {
      too_high: '⬇️ Lower hips!',
      too_low: '⬆️ Lift hips!',
      perfect: '✅ Good bridge!'
    }
  }
};

// ─── Helper Functions ──────────────────────────────────────────

// Calculate angle from 3 points
function calcAngle(a, b, c) {
  const rad = Math.atan2(c[1] - b[1], c[0] - b[0]) -
              Math.atan2(a[1] - b[1], a[0] - b[0]);
  let angle = Math.abs(rad * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// Evaluate exercise form from landmarks
function evaluateExercise(landmarks, exerciseKey) {
  const ex = EXERCISES[exerciseKey];
  if (!ex) {
    return { feedback: 'Unknown exercise', correct: false, angle: 0, details: {} };
  }

  // Plank special case
  if (exerciseKey === 'PLANK') {
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const diff = avgHipY - avgShoulderY;
    const { min, max } = ex.ideal;
    let feedback, correct;
    if (diff > max) { feedback = ex.feedback.too_high; correct = false; }
    else if (diff < min) { feedback = ex.feedback.too_low; correct = false; }
    else { feedback = ex.feedback.perfect; correct = true; }
    return { feedback, correct, angle: diff, details: { hipY: avgHipY, shoulderY: avgShoulderY } };
  }

  // Joint-based exercises
  const angles = {};
  const angleValues = ex.joints.map(j => {
    const p1 = [landmarks[j.p1].x, landmarks[j.p1].y];
    const p2 = [landmarks[j.p2].x, landmarks[j.p2].y];
    const p3 = [landmarks[j.p3].x, landmarks[j.p3].y];
    const angle = calcAngle(p1, p2, p3);
    angles[j.name] = angle;
    return angle;
  });

  if (angleValues.length === 0) {
    return { feedback: 'No joints to measure', correct: false, angle: 0, details: {} };
  }

  const avgAngle = angleValues.reduce((a, b) => a + b, 0) / angleValues.length;
  const { min, max } = ex.ideal;
  let feedback, correct;
  if (avgAngle > max) { feedback = ex.feedback.too_high; correct = false; }
  else if (avgAngle < min) { feedback = ex.feedback.too_low; correct = false; }
  else { feedback = ex.feedback.perfect; correct = true; }

  return { feedback, correct, angle: avgAngle, details: angles };
}

// Get today's schedule
function getTodaySchedule() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const schedule = SCHEDULE[today];
  return {
    day: today,
    workout: schedule.workout,
    exercises: schedule.exercises.map(id => ({
      id,
      ...EXERCISES[id]
    }))
  };
}

// ─── WebSocket Server ──────────────────────────────────────────

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  clients.add(ws);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, image, exercise, sessionId } = data;

      // Handle different message types
      switch (type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'analyze': {
          if (!image || !exercise) {
            ws.send(JSON.stringify({
              type: 'feedback',
              error: 'Missing image or exercise',
              feedback: '⚠️ Error: missing data',
              correct: false,
              angle: 0
            }));
            return;
          }

          // Process the image
          try {
            // For demo, simulate analysis with random feedback
            // In production, you'd call MediaPipe Python script here
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

            // Add some variation
            angle += (Math.random() - 0.5) * 10;

            ws.send(JSON.stringify({
              type: 'feedback',
              exercise,
              feedback,
              correct,
              angle: Math.round(angle),
              demo: ex.demo || '🧍',
              name: ex.name,
              timestamp: Date.now()
            }));

          } catch (err) {
            console.error('Analysis error:', err);
            ws.send(JSON.stringify({
              type: 'feedback',
              error: 'Analysis failed',
              feedback: '⚠️ Error processing frame',
              correct: false,
              angle: 0
            }));
          }
          break;
        }

        case 'start_recording': {
          const sessionId = data.sessionId || uuidv4();
          ws.send(JSON.stringify({
            type: 'recording_started',
            sessionId,
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
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${type}`
          }));
      }
    } catch (err) {
      console.error('WebSocket error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});

// Broadcast to all clients
function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ─── Routes ──────────────────────────────────────────────────────

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// Serve the Telegram Mini App version
app.get('/tg', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'tg-index.html'));
});

// ================================================================
//  API ROUTES
// ================================================================

// 1. Get schedule for today
app.get('/api/schedule/today', (req, res) => {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const schedule = SCHEDULE[today];
  const exercises = schedule.exercises
    .filter(id => EXERCISES[id])
    .map(id => ({
      id,
      name: EXERCISES[id].name,
      icon: EXERCISES[id].icon,
      muscle: EXERCISES[id].muscle,
      demo: EXERCISES[id].demo
    }));

  res.json({
    day: today,
    workout: schedule.workout,
    exercises,
    fullSchedule: SCHEDULE
  });
});

// 2. Get full schedule
app.get('/api/schedule', (req, res) => {
  const fullSchedule = {};
  Object.keys(SCHEDULE).forEach(day => {
    fullSchedule[day] = {
      workout: SCHEDULE[day].workout,
      exercises: SCHEDULE[day].exercises
        .filter(id => EXERCISES[id])
        .map(id => ({
          id,
          name: EXERCISES[id].name,
          icon: EXERCISES[id].icon,
          muscle: EXERCISES[id].muscle
        }))
    };
  });
  res.json({
    schedule: fullSchedule,
    today: new Date().toLocaleDateString('en-US', { weekday: 'long' })
  });
});

// 3. Get all exercises
app.get('/api/exercises', (req, res) => {
  const list = Object.keys(EXERCISES).map(key => ({
    id: key,
    name: EXERCISES[key].name,
    icon: EXERCISES[key].icon,
    muscle: EXERCISES[key].muscle,
    demo: EXERCISES[key].demo,
    desc: EXERCISES[key].desc,
    tip: EXERCISES[key].tip
  }));
  res.json(list);
});

// 4. Get specific exercise
app.get('/api/exercises/:id', (req, res) => {
  const ex = EXERCISES[req.params.id];
  if (!ex) {
    return res.status(404).json({ error: 'Exercise not found' });
  }
  res.json(ex);
});

// 5. Analyze a single frame
app.post('/api/analyze', express.json({ limit: '10mb' }), (req, res) => {
  const { image, exercise } = req.body;
  if (!image || !exercise) {
    return res.status(400).json({ error: 'Missing image or exercise' });
  }

  // For demo, return mock analysis
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
    feedback,
    correct,
    angle: Math.round(angle),
    exercise,
    name: ex.name,
    demo: ex.demo
  });
});

// 6. Upload and record a video
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

  // Save metadata
  const metaPath = req.file.path + '.meta.json';
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  // Add to history
  workoutHistory.push(metadata);

  res.json({
    success: true,
    message: 'Video uploaded successfully',
    ...metadata
  });
});

// 7. Get workout history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = workoutHistory
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  res.json(history);
});

// 8. Get user's history
app.get('/api/history/:userId', (req, res) => {
  const { userId } = req.params;
  const history = workoutHistory
    .filter(h => h.userId === userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(history);
});

// 9. Get a specific video's analysis
app.get('/api/video/:filename', (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const metaPath = videoPath + '.meta.json';
  let metadata = {};
  if (fs.existsSync(metaPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {}
  }

  res.json({
    filename,
    url: `/uploads/${filename}`,
    metadata,
    // In production, you'd return frame-by-frame analysis here
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

// 10. Get list of all uploaded videos
app.get('/api/videos', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to list videos' });
    }

    const videos = files
      .filter(f => /\.(mp4|webm|mov|avi)$/i.test(f))
      .map(f => {
        const metaPath = path.join(UPLOAD_DIR, f + '.meta.json');
        let metadata = {};
        if (fs.existsSync(metaPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch (e) {}
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

// 11. Delete a video
app.delete('/api/video/:filename', (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(UPLOAD_DIR, filename);
  const metaPath = videoPath + '.meta.json';

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  try {
    fs.unlinkSync(videoPath);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// 12. User session management
app.post('/api/session', (req, res) => {
  const { userId, name } = req.body;
  const sessionId = uuidv4();
  sessions.set(sessionId, {
    userId: userId || 'anonymous',
    name: name || 'Athlete',
    startTime: new Date().toISOString()
  });
  res.json({ sessionId });
});

app.get('/api/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// 13. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    clients: clients.size,
    videos: fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp4|webm|mov|avi)$/i.test(f)).length
  });
});

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_DIR));

// ─── Error Handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
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
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`📊 Exercises loaded: ${Object.keys(EXERCISES).length}`);
  console.log(`📅 Schedule: ${Object.keys(SCHEDULE).length} days`);
  console.log('========================================\n');
});

// ─── Cleanup old files (keep last 30 days) ────────────────────
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
          // Also delete metadata
          const metaPath = filePath + '.meta.json';
          if (fs.existsSync(metaPath)) {
            fs.unlink(metaPath, () => {});
          }
        }
      });
    });
  });
}, 24 * 60 * 60 * 1000); // run daily

// ─── Export for testing ────────────────────────────────────────
module.exports = { app, server, wss, EXERCISES, SCHEDULE };
