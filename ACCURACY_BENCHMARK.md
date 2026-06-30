# Occulert Detection Accuracy Benchmark Guide

This document outlines how to formally validate Occulert's drowsiness detection accuracy against ground-truth datasets, and tracks the current benchmark status.

---

## Current Status

| Item | Status |
|------|--------|
| Algorithm | MediaPipe FaceMesh EAR (Eye Aspect Ratio) + PERCLOS |
| Sensitivity presets | Low / Medium / High (tunable thresholds) |
| Formal dataset validation | ⏳ Not yet completed |
| Peer-reviewed publication | ⏳ Not yet completed |
| Last updated | June 2026 |

---

## Target Datasets

These are the standard open datasets used for drowsy driver detection research:

### 1. NTHU Drowsy Driver Detection Dataset
- **Source:** National Tsing Hua University, Taiwan
- **URL:** http://cv.cs.nthu.edu.tw/php/callforpaper/datasets/DDD/
- **Contents:** ~36 subjects, daytime/nighttime, glasses/no glasses, indoor/outdoor lighting
- **Ground truth:** Frame-level drowsiness labels
- **Why use it:** Widely cited benchmark — lets you compare against published papers

### 2. DROZY Dataset
- **Source:** University of Mons, Belgium
- **URL:** http://www.drozy.ulg.ac.be/
- **Contents:** EEG + video + Karolinska Sleepiness Scale (KSS) scores
- **Ground truth:** Subjective + physiological sleepiness labels
- **Why use it:** EEG ground truth is more objective than self-report

### 3. UTA Real-Life Drowsiness Dataset
- **Source:** University of Texas Arlington
- **Contents:** Real driving footage with verified drowsiness events
- **Why use it:** Real-world (not lab) conditions

---

## How to Run the Benchmark

### Step 1: Obtain a dataset
Download the NTHU DDD dataset (requires a request form on their site). You will receive labeled video clips: `awake`, `low_fatigue`, `high_fatigue`, `drowsy`.

### Step 2: Extract EAR values from clips
Run MediaPipe FaceMesh on each video clip and compute EAR per frame. You can use the Python snippet below:

```python
import cv2
import mediapipe as mp
import numpy as np

mp_face = mp.solutions.face_mesh

# Eye landmark indices (MediaPipe FaceMesh)
LEFT_EYE  = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33,  160, 158, 133, 153, 144]

def eye_aspect_ratio(landmarks, eye_indices, img_w, img_h):
    pts = [(int(landmarks[i].x * img_w), int(landmarks[i].y * img_h)) for i in eye_indices]
        A = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
            B = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
                C = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
                    return (A + B) / (2.0 * C)

                    cap = cv2.VideoCapture('path/to/clip.avi')
                    with mp_face.FaceMesh(static_image_mode=False, max_num_faces=1) as face_mesh:
                        while cap.isOpened():
                                ret, frame = cap.read()
                                        if not ret:
                                                    break
                                                            h, w = frame.shape[:2]
                                                                    results = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                                                                            if results.multi_face_landmarks:
                                                                                        lm = results.multi_face_landmarks[0].landmark
                                                                                                    left_ear  = eye_aspect_ratio(lm, LEFT_EYE,  w, h)
                                                                                                                right_ear = eye_aspect_ratio(lm, RIGHT_EYE, w, h)
                                                                                                                            avg_ear = (left_ear + right_ear) / 2
                                                                                                                                        print(avg_ear)
                                                                                                                                        cap.release()
                                                                                                                                        ```
                                                                                                                                        
                                                                                                                                        ### Step 3: Apply Occulert thresholds and compare to labels
                                                                                                                                        
                                                                                                                                        For each frame, apply the three sensitivity presets and check against ground truth:
                                                                                                                                        
                                                                                                                                        ```python
                                                                                                                                        SENSITIVITY = {
                                                                                                                                            'low':    {'closed': 0.15, 'watch': 0.19},
                                                                                                                                                'medium': {'closed': 0.18, 'watch': 0.22},
                                                                                                                                                    'high':   {'closed': 0.21, 'watch': 0.25},
                                                                                                                                                    }
                                                                                                                                                    
                                                                                                                                                    # For each frame: predicted = 'alert' | 'watch' | 'closed'
                                                                                                                                                    # Compare to ground truth label
                                                                                                                                                    # Calculate: True Positive, False Positive, True Negative, False Negative
                                                                                                                                                    # Report: Precision, Recall, F1, False Alert Rate
                                                                                                                                                    ```
                                                                                                                                                    
                                                                                                                                                    ### Step 4: Record results here
                                                                                                                                                    
                                                                                                                                                    Update the table below when benchmarking is complete:
                                                                                                                                                    
                                                                                                                                                    | Dataset | Sensitivity | Precision | Recall | F1 | False Alert Rate |
                                                                                                                                                    |---------|------------|-----------|--------|----|------------------|
                                                                                                                                                    | NTHU DDD | Low | TBD | TBD | TBD | TBD |
                                                                                                                                                    | NTHU DDD | Medium | TBD | TBD | TBD | TBD |
                                                                                                                                                    | NTHU DDD | High | TBD | TBD | TBD | TBD |
                                                                                                                                                    | DROZY | Medium | TBD | TBD | TBD | TBD |
                                                                                                                                                    
                                                                                                                                                    ---
                                                                                                                                                    
                                                                                                                                                    ## What "Good" Looks Like
                                                                                                                                                    
                                                                                                                                                    For a driver safety tool, prioritize **recall over precision** — it is better to have a false alert (driver is fine but app warns them) than a missed alert (driver is drowsy but app stays silent).
                                                                                                                                                    
                                                                                                                                                    - **Target recall:** > 85% on drowsy/high-fatigue frames
                                                                                                                                                    - **Target false alert rate:** < 15% on awake frames at Medium sensitivity
                                                                                                                                                    - **Stretch goal:** > 90% recall, < 10% false alert rate
                                                                                                                                                    
                                                                                                                                                    ---
                                                                                                                                                    
                                                                                                                                                    ## Publishing Results
                                                                                                                                                    
                                                                                                                                                    Once benchmarked, publish results:
                                                                                                                                                    1. Update this file with the completed table
                                                                                                                                                    2. Add a "Validated Accuracy" badge/section to README.md
                                                                                                                                                    3. Add a brief accuracy statement to safety.html
                                                                                                                                                    4. Consider submitting a short paper to an HCI or transportation safety venue
                                                                                                                                                    
                                                                                                                                                    ---
                                                                                                                                                    
                                                                                                                                                    *Occulert™ · San Francisco, CA · accuracy benchmark guide v1.0*
