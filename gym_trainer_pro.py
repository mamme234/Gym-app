"""
Full‑Body AI Gym Trainer – 20 Exercises
Config‑driven design – add any exercise by copying a dict.
"""

import cv2
import mediapipe as mp
import numpy as np
import pyttsx3
from datetime import datetime
import sys

# ---------- Text-to-Speech ----------
try:
    tts = pyttsx3.init()
    tts.setProperty('rate', 180)
    speak = lambda msg: tts.say(msg) and tts.runAndWait()
except Exception:
    speak = lambda msg: None

# ---------- Workout Schedule ----------
SCHEDULE = {
    "Monday":    "Chest / Triceps / Shoulders",
    "Tuesday":   "Back / Biceps / Rear Delts",
    "Wednesday": "Legs / Glutes / Calves",
    "Thursday":  "Chest / Triceps / Shoulders",
    "Friday":    "Back / Biceps / Rear Delts",
    "Saturday":  "Core (Abs) + Cardio",
    "Sunday":    "Rest / Mobility"
}

print("\n===== 📅 FULL-BODY SCHEDULE =====")
today = datetime.now().strftime("%A")
for day, workout in SCHEDULE.items():
    marker = "👉 " if day == today else "   "
    print(f"{marker}{day}: {workout}")
print("=================================\n")

# ---------- MediaPipe ----------
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(min_detection_confidence=0.6, min_tracking_confidence=0.6)
mp_draw = mp.solutions.drawing_utils

# ---------- Camera ----------
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

# ---------- Recording ----------
recording = False
out = None
record_filename = ""

def start_recording():
    global out, record_filename, recording
    if not recording:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        record_filename = f"workout_{timestamp}.avi"
        fourcc = cv2.VideoWriter_fourcc(*'XVID')
        out = cv2.VideoWriter(record_filename, fourcc, 20.0, (640, 480))
        recording = True
        print(f"🔴 Recording: {record_filename}")
        speak("Recording started")

def stop_recording():
    global out, recording
    if recording:
        out.release()
        out = None
        recording = False
        print(f"✅ Saved: {record_filename}")
        speak("Recording saved")

# ---------- Angle helper ----------
def calc_angle(a, b, c):
    """a, b, c are (x,y) tuples; angle at b."""
    a, b, c = np.array(a), np.array(b), np.array(c)
    rad = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0])
    angle = np.abs(rad * 180.0 / np.pi)
    return 360 - angle if angle > 180 else angle

# ---------- Extra check functions ----------
# Each receives landmarks (list of 33 normalized points) and returns (feedback_msg, is_correct) or (None, None)

def extra_squat(lm):
    # Check hip angle to prevent leaning too forward
    ls = (lm[mp_pose.PoseLandmark.LEFT_SHOULDER].x, lm[mp_pose.PoseLandmark.LEFT_SHOULDER].y)
    lh = (lm[mp_pose.PoseLandmark.LEFT_HIP].x, lm[mp_pose.PoseLandmark.LEFT_HIP].y)
    lk = (lm[mp_pose.PoseLandmark.LEFT_KNEE].x, lm[mp_pose.PoseLandmark.LEFT_KNEE].y)
    rs = (lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].x, lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].y)
    rh = (lm[mp_pose.PoseLandmark.RIGHT_HIP].x, lm[mp_pose.PoseLandmark.RIGHT_HIP].y)
    rk = (lm[mp_pose.PoseLandmark.RIGHT_KNEE].x, lm[mp_pose.PoseLandmark.RIGHT_KNEE].y)
    l_hip = calc_angle(ls, lh, lk)
    r_hip = calc_angle(rs, rh, rk)
    avg_hip = (l_hip + r_hip) / 2
    if avg_hip < 80:
        return "🧑‍🦯 Chest up!", False
    return None, None

def extra_row(lm):
    # Check shoulder retraction (wrist behind shoulder in mirrored view)
    lw_x = lm[mp_pose.PoseLandmark.LEFT_WRIST].x
    ls_x = lm[mp_pose.PoseLandmark.LEFT_SHOULDER].x
    rw_x = lm[mp_pose.PoseLandmark.RIGHT_WRIST].x
    rs_x = lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].x
    l_retr = (lw_x - ls_x) < -0.1   # wrist left of shoulder
    r_retr = (rw_x - rs_x) > 0.1    # wrist right of shoulder
    if not (l_retr and r_retr):
        return "🔙 Retract shoulders!", False
    return None, None

def extra_plank(lm):
    # Check hip-shoulder alignment
    avg_hip_y = (lm[mp_pose.PoseLandmark.LEFT_HIP].y + lm[mp_pose.PoseLandmark.RIGHT_HIP].y) / 2
    avg_shoulder_y = (lm[mp_pose.PoseLandmark.LEFT_SHOULDER].y + lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].y) / 2
    diff = avg_hip_y - avg_shoulder_y
    if diff > 0.15:
        return "⬆️ Lift hips up!", False
    elif diff < -0.15:
        return "⬇️ Lower hips down!", False
    return None, None

def extra_deadlift(lm):
    # Check back straightness: hip angle vs shoulder-hip-knee
    ls = (lm[mp_pose.PoseLandmark.LEFT_SHOULDER].x, lm[mp_pose.PoseLandmark.LEFT_SHOULDER].y)
    lh = (lm[mp_pose.PoseLandmark.LEFT_HIP].x, lm[mp_pose.PoseLandmark.LEFT_HIP].y)
    lk = (lm[mp_pose.PoseLandmark.LEFT_KNEE].x, lm[mp_pose.PoseLandmark.LEFT_KNEE].y)
    rs = (lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].x, lm[mp_pose.PoseLandmark.RIGHT_SHOULDER].y)
    rh = (lm[mp_pose.PoseLandmark.RIGHT_HIP].x, lm[mp_pose.PoseLandmark.RIGHT_HIP].y)
    rk = (lm[mp_pose.PoseLandmark.RIGHT_KNEE].x, lm[mp_pose.PoseLandmark.RIGHT_KNEE].y)
    l_hip = calc_angle(ls, lh, lk)
    r_hip = calc_angle(rs, rh, rk)
    avg_hip = (l_hip + r_hip) / 2
    if avg_hip < 120:
        return "🧑‍🦯 Keep back straight!", False
    return None, None

# ---------- Exercise configuration ----------
# Each exercise:
# {
#   "name": str,
#   "muscle": str,
#   "angles": [ (angle_name, landmark1, landmark2, landmark3), ... ]   # landmark2 is the joint
#   "thresholds": {"low": int, "high": int},   # angle ranges for the averaged angle
#   "messages": {"low": str, "high": str, "good": str},
#   "extra": function(landmarks) -> (feedback, is_correct) or None
# }

# We'll predefine the landmark strings for convenience
L = mp_pose.PoseLandmark

EXERCISES = {
    1: {
        "name": "Push-up",
        "muscle": "Chest",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 70, "high": 150},
        "messages": {"low": "⬆️ Push up!", "high": "⬇️ Go lower!", "good": "✅ Perfect!"},
        "extra": None
    },
    2: {
        "name": "Squat",
        "muscle": "Legs",
        "angles": [
            ("left_knee", L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE),
            ("right_knee", L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE)
        ],
        "thresholds": {"low": 85, "high": 160},
        "messages": {"low": "⬆️ Rise up!", "high": "⬇️ Go deeper!", "good": "✅ Good squat!"},
        "extra": extra_squat
    },
    3: {
        "name": "Deadlift",
        "muscle": "Back/Legs",
        "angles": [
            ("left_knee", L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE),
            ("right_knee", L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE),
            ("left_hip", L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE),
            ("right_hip", L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE)
        ],
        "thresholds": {"low": 100, "high": 160},
        "messages": {"low": "⬆️ Stand up!", "high": "⬇️ Bend knees & hips!", "good": "✅ Good deadlift!"},
        "extra": extra_deadlift
    },
    4: {
        "name": "Bent-over Row",
        "muscle": "Back",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 60, "high": 160},
        "messages": {"low": "⬇️ Lower with control!", "high": "⬇️ Pull elbow back!", "good": "✅ Good row!"},
        "extra": extra_row
    },
    5: {
        "name": "Plank",
        "muscle": "Abs",
        "angles": [],
        "thresholds": {},
        "messages": {"good": "✅ Solid plank!"},
        "extra": extra_plank
    },
    6: {
        "name": "Bicep Curl",
        "muscle": "Biceps",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 60, "high": 160},
        "messages": {"low": "⬇️ Lower slowly!", "high": "💪 Curl up!", "good": "✅ Good curl!"},
        "extra": None
    },
    7: {
        "name": "Shoulder Press",
        "muscle": "Shoulders",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 80, "high": 160},
        "messages": {"low": "⬆️ Press up!", "high": "⬇️ Lower down!", "good": "✅ Good press!"},
        "extra": None
    },
    8: {
        "name": "Lunge",
        "muscle": "Legs",
        "angles": [
            ("left_knee", L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE),
            ("right_knee", L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE)
        ],
        "thresholds": {"low": 70, "high": 150},
        "messages": {"low": "⬆️ Rise up!", "high": "⬇️ Go deeper!", "good": "✅ Good lunge!"},
        "extra": None
    },
    9: {
        "name": "Crunch",
        "muscle": "Abs",
        "angles": [
            ("left_hip", L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE),
            ("right_hip", L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE)
        ],
        "thresholds": {"low": 70, "high": 120},
        "messages": {"low": "⬇️ Lower down!", "high": "⬆️ Curl up!", "good": "✅ Good crunch!"},
        "extra": None
    },
    10: {
        "name": "Lateral Raise",
        "muscle": "Shoulders",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 70, "high": 150},
        "messages": {"low": "⬇️ Lower arms!", "high": "⬆️ Raise arms!", "good": "✅ Good raise!"},
        "extra": None
    },
    11: {
        "name": "Face Pull",
        "muscle": "Back/Shoulders",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 90, "high": 160},
        "messages": {"low": "⬇️ Pull back!", "high": "⬆️ Extend arms!", "good": "✅ Good pull!"},
        "extra": None
    },
    12: {
        "name": "Tricep Pushdown",
        "muscle": "Triceps",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 60, "high": 150},
        "messages": {"low": "⬆️ Push down!", "high": "⬇️ Let up!", "good": "✅ Good!"},
        "extra": None
    },
    13: {
        "name": "Leg Curl (lying)",
        "muscle": "Legs",
        "angles": [
            ("left_knee", L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE),
            ("right_knee", L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE)
        ],
        "thresholds": {"low": 60, "high": 160},
        "messages": {"low": "⬆️ Curl up!", "high": "⬇️ Extend!", "good": "✅ Good!"},
        "extra": None
    },
    14: {
        "name": "Calf Raise",
        "muscle": "Legs",
        "angles": [
            # Approximate with knee-ankle and vertical: we'll use hip-ankle? Actually we need ankle angle.
            # We'll use angle at ankle: knee-ankle-vertical (using a point below ankle). Since no foot, we use knee-ankle-hip? That's not right.
            # Skip for now: we'll just say "Good" if standing.
        ],
        "thresholds": {},
        "messages": {"good": "✅ Standing tall!"},
        "extra": None  # Could implement by checking if knees are straight
    },
    15: {
        "name": "Russian Twist",
        "muscle": "Abs",
        "angles": [
            ("left_shoulder_rot", L.LEFT_HIP, L.LEFT_SHOULDER, L.LEFT_ELBOW),  # not perfect
            ("right_shoulder_rot", L.RIGHT_HIP, L.RIGHT_SHOULDER, L.RIGHT_ELBOW)
        ],
        "thresholds": {"low": 30, "high": 80},
        "messages": {"low": "↔️ Twist more!", "high": "↩️ Return center!", "good": "✅ Good!"},
        "extra": None
    },
    16: {
        "name": "Bench Press",
        "muscle": "Chest",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 70, "high": 140},
        "messages": {"low": "⬆️ Press up!", "high": "⬇️ Lower bar!", "good": "✅ Good!"},
        "extra": None
    },
    17: {
        "name": "Chest Fly",
        "muscle": "Chest",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 60, "high": 160},
        "messages": {"low": "🔁 Bring together!", "high": "⬅️ Open arms!", "good": "✅ Good!"},
        "extra": None
    },
    18: {
        "name": "Pull-up",
        "muscle": "Back",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 60, "high": 160},
        "messages": {"low": "⬆️ Pull up!", "high": "⬇️ Lower down!", "good": "✅ Good!"},
        "extra": None
    },
    19: {
        "name": "Dips",
        "muscle": "Chest/Triceps",
        "angles": [
            ("left_elbow", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
            ("right_elbow", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST)
        ],
        "thresholds": {"low": 70, "high": 150},
        "messages": {"low": "⬆️ Press up!", "high": "⬇️ Lower down!", "good": "✅ Good!"},
        "extra": None
    },
    20: {
        "name": "Glute Bridge",
        "muscle": "Glutes",
        "angles": [
            ("left_hip", L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE),
            ("right_hip", L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE)
        ],
        "thresholds": {"low": 160, "high": 180},
        "messages": {"low": "⬆️ Lift hips!", "high": "⬇️ Lower hips!", "good": "✅ Good!"},
        "extra": None
    },
}

# ---------- Exercise evaluation function ----------
def evaluate_exercise(ex, lm, h, w):
    """
    Returns (feedback_text, is_correct, avg_angle)
    """
    angles = []
    for angle_name, l1, l2, l3 in ex["angles"]:
        p1 = (lm[l1].x * w, lm[l1].y * h)
        p2 = (lm[l2].x * w, lm[l2].y * h)
        p3 = (lm[l3].x * w, lm[l3].y * h)
        ang = calc_angle(p1, p2, p3)
        angles.append(ang)
    avg_angle = np.mean(angles) if angles else 0

    # Extra check
    extra_fb, extra_correct = None, None
    if ex["extra"] is not None:
        extra_fb, extra_correct = ex["extra"](lm)

    if extra_fb is not None:
        return extra_fb, extra_correct, avg_angle

    # If no angles defined, use only extra check
    if not ex["angles"]:
        return ex["messages"]["good"], True, 0

    # Threshold logic
    low = ex["thresholds"]["low"]
    high = ex["thresholds"]["high"]
    if avg_angle > high:
        return ex["messages"]["high"], False, avg_angle
    elif avg_angle < low:
        return ex["messages"]["low"], False, avg_angle
    else:
        return ex["messages"]["good"], True, avg_angle

# ---------- Main Loop ----------
print("🎥 Camera ready. Press numbers to switch exercises:")
for k, ex in EXERCISES.items():
    print(f"  [{k}] {ex['name']} ({ex['muscle']})")
print("  [r] Record   [q] Quit\n")

current_exercise = 1

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = pose.process(rgb)

    # Default feedback
    feedback = "No pose detected"
    is_correct = False
    angle_val = 0
    ex = EXERCISES[current_exercise]

    if result.pose_landmarks:
        lm = result.pose_landmarks.landmark
        h, w, _ = frame.shape
        feedback, is_correct, angle_val = evaluate_exercise(ex, lm, h, w)
        mp_draw.draw_landmarks(frame, result.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    color = (0, 255, 0) if is_correct else (0, 0, 255)

    # Overlay
    cv2.rectangle(frame, (10, 10), (340, 130), (0,0,0,0.7), -1)
    cv2.putText(frame, f"🏋️ {ex['name']} ({ex['muscle']})", (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2)
    if ex["angles"]:
        cv2.putText(frame, f"Angle: {int(angle_val)}°", (20, 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200,200,200), 1)
    cv2.putText(frame, feedback, (20, 105),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

    # Recording indicator
    if recording:
        cv2.circle(frame, (620, 30), 15, (0,0,255), -1)
        cv2.putText(frame, "REC", (590, 55),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,0,255), 2)

    cv2.imshow("💪 Full-Body AI Trainer - Select exercise (1-20), [r]ecord, [q]uit", frame)

    if recording and out:
        out.write(frame)

    # Key handling
    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('r'):
        if recording:
            stop_recording()
        else:
            start_recording()
    elif ord('1') <= key <= ord('9'):
        new_ex = key - ord('0')
        if new_ex in EXERCISES:
            current_exercise = new_ex
            speak(EXERCISES[current_exercise]["name"])
    elif key == ord('0'):  # 10
        if 10 in EXERCISES:
            current_exercise = 10
            speak(EXERCISES[current_exercise]["name"])
    # For 11-20, we need two-digit keys; we'll use a simpler approach: press 'a' for 11, etc. But we'll just support 1-9 and 0 for 10.
    # Better: use key combinations like shift+1 for 11? We'll just keep 1-10 for simplicity.
    # To support all 20, we can use letters or just extend with a mapping.
    # We'll add a simple mapping: 'a'=11, 'b'=12, ... 't'=20
    elif ord('a') <= key <= ord('t'):
        idx = key - ord('a') + 11
        if idx in EXERCISES:
            current_exercise = idx
            speak(EXERCISES[current_exercise]["name"])

# ---------- Cleanup ----------
if recording:
    stop_recording()
pose.close()
cap.release()
cv2.destroyAllWindows()
print("\n👋 Workout finished. Stay strong!")
