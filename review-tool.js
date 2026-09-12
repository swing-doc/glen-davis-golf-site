// ====================================================================
// SWING REVIEW TOOL -- main logic
// Loads two local video files (no upload, no server) and lets a coach
// use frame-stepping, slow-mo, drawing, AI pose overlay, guide lines,
// voice notes, and synced side-by-side comparison on them.
// ====================================================================

var videoUrlDTL = null;
var videoUrlFO = null;
var activeView = 'dtl'; // 'dtl' or 'fo'

var loadPanel = document.getElementById('loadPanel');
var reviewArea = document.getElementById('reviewArea');
var fileDTL = document.getElementById('fileDTL');
var fileFO = document.getElementById('fileFO');
var fileInfo = document.getElementById('fileInfo');
var chipDTL = document.getElementById('chipDTL');
var chipFO = document.getElementById('chipFO');
var chipInfo = document.getElementById('chipInfo');
var startReviewBtn = document.getElementById('startReviewBtn');
var loadError = document.getElementById('loadError');

function extractNameFromFilename(fname) {
  var m = fname.match(/^\d{4}-\d{2}-\d{2}_\d{4}_(.+?)_(DownTheLine|FaceOn)_/);
  return m ? m[1].replace(/_/g, ' ') : '';
}

function wireLoadBox(input, chipEl) {
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (f) {
      chipEl.innerHTML = '<div class="file-chip">✓ ' + f.name + '</div>';
      var nameField = document.getElementById('stName');
      if (nameField && !nameField.value.trim()) {
        var guessedName = extractNameFromFilename(f.name);
        if (guessedName) nameField.value = guessedName;
      }
    }
  });
}
wireLoadBox(fileDTL, chipDTL);
wireLoadBox(fileFO, chipFO);

function parseInfoFileText(text) {
  var result = {};
  text.split('\n').forEach(function (line) {
    var m = line.match(/^\s*(Name|Email|Phone)\s*:\s*(.*)$/i);
    if (m) result[m[1].toLowerCase()] = m[2].trim();
  });
  return result;
}

if (fileInfo) {
  fileInfo.addEventListener('change', function () {
    var f = fileInfo.files && fileInfo.files[0];
    if (!f) return;
    chipInfo.innerHTML = '<div class="file-chip">✓ ' + f.name + '</div>';
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseInfoFileText(String(reader.result));
      if (parsed.name) document.getElementById('stName').value = parsed.name;
      if (parsed.email) document.getElementById('stEmail').value = parsed.email;
      if (parsed.phone) document.getElementById('stPhone').value = parsed.phone;
    };
    reader.readAsText(f);
  });
}

startReviewBtn.addEventListener('click', function () {
  var dtl = fileDTL.files && fileDTL.files[0];
  var fo = fileFO.files && fileFO.files[0];
  if (!dtl || !fo) {
    loadError.classList.add('show');
    return;
  }
  loadError.classList.remove('show');
  if (videoUrlDTL) URL.revokeObjectURL(videoUrlDTL);
  if (videoUrlFO) URL.revokeObjectURL(videoUrlFO);
  videoUrlDTL = URL.createObjectURL(dtl);
  videoUrlFO = URL.createObjectURL(fo);

  document.getElementById('compareVideoA').src = videoUrlDTL;
  document.getElementById('compareVideoB').src = videoUrlFO;

  setActiveView('dtl');
  updateStudentContact();
  reviewArea.classList.add('active');
  reviewArea.scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('resetToolBtn').addEventListener('click', function () {
  reviewArea.classList.remove('active');
  fileDTL.value = ''; fileFO.value = '';
  chipDTL.innerHTML = ''; chipFO.innerHTML = '';
  if (fileInfo) fileInfo.value = '';
  if (chipInfo) chipInfo.innerHTML = '';
  document.getElementById('stName').value = '';
  document.getElementById('stEmail').value = '';
  document.getElementById('stPhone').value = '';
  document.getElementById('notesList').innerHTML = '';
  document.getElementById('voiceNotesList').innerHTML = '';
  resetAnalysisPlayer();
  resetComparePlayer();
  loadPanel.scrollIntoView({ behavior: 'smooth' });
});

// ---- View tabs (which video the single analysis player shows) ----
var tabDTL = document.getElementById('tabDTL');
var tabFO = document.getElementById('tabFO');
var analysisVideo = document.getElementById('analysisVideo');

function setActiveView(view) {
  activeView = view;
  tabDTL.classList.toggle('active', view === 'dtl');
  tabFO.classList.toggle('active', view === 'fo');
  analysisVideo.pause();
  analysisVideo.src = view === 'dtl' ? videoUrlDTL : videoUrlFO;
  analysisVideo.classList.remove('flipped');
  if (flipToggleBtn) flipToggleBtn.classList.remove('active');
  clearStrokes();
  resetPoseSmoothing();
  document.getElementById('notesList').innerHTML = '';
  setPlayLabel(false);
}
tabDTL.addEventListener('click', function () { setActiveView('dtl'); });
tabFO.addEventListener('click', function () { setActiveView('fo'); });

// ---- Element refs (analysis player) ----
var panel1Dummy = null; // not used in this tool, kept for shared function signatures
var dot1 = null, dot2 = null, dot3 = null;
var payBtn = null, submitBtn = null, restartBtn = null;
var videoInput = null, uploadBox = null, filePreviewSlot = null;
var yourSwingThumb = null, yourSwingVideo = null, yourSwingSampleImg = null, yourSwingCaption = null;
var analysisPlayBtn = document.getElementById('analysisPlayBtn');
var playIconSvg = document.getElementById('playIconSvg');
var playBtnLabel = document.getElementById('playBtnLabel');
var stepBackBtn = document.getElementById('stepBackBtn');
var stepFwdBtn = document.getElementById('stepFwdBtn');
var speedBtns = document.querySelectorAll('.speed-btn');
var scrubBar = document.getElementById('scrubBar');
var scrubTime = document.getElementById('scrubTime');
var notesList = document.getElementById('notesList');
var analysisVideoWrap = document.getElementById('analysisVideoWrap');
var drawCanvas = document.getElementById('drawCanvas');
var drawCtx = drawCanvas ? drawCanvas.getContext('2d') : null;
var drawToggleBtn = document.getElementById('drawToggleBtn');
var flipToggleBtn = document.getElementById('flipToggleBtn');
var poseToggleBtn = document.getElementById('poseToggleBtn');
var poseCanvas = document.getElementById('poseCanvas');
var poseCtx = poseCanvas ? poseCanvas.getContext('2d') : null;
var guideToggleBtn = document.getElementById('guideToggleBtn');
var guideV = document.getElementById('guideV');
var guideH = document.getElementById('guideH');
var exportFrameBtn = document.getElementById('exportFrameBtn');
var drawToolbar = document.getElementById('drawToolbar');
var toolBtns = document.querySelectorAll('.tool-btn');
var colorSwatches = document.querySelectorAll('.color-swatch');
var clearDrawBtn = document.getElementById('clearDrawBtn');
var FRAME_STEP = 1 / 25;
var drawMode = false;
var currentTool = 'line';
var currentColor = '#E0A526';
var strokes = [];
var activeStroke = null;
var isDrawing = false;
var anglePoints = [];

function showPanel() { /* single-player tool has no multi-panel flow; kept as no-op for shared code shape */ }

function formatT(s) { return s.toFixed(1) + 's'; }

function setPlayLabel(isPlaying) {
  playBtnLabel.textContent = isPlaying ? 'Pause' : 'Play';
  playIconSvg.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14" fill="#1A1D21"/><rect x="14" y="5" width="4" height="14" fill="#1A1D21"/>'
    : '<path d="M8 5v14l11-7-11-7z" fill="#1A1D21"/>';
}

if (analysisPlayBtn) {
  analysisPlayBtn.addEventListener('click', function () {
    if (analysisVideo.paused) analysisVideo.play(); else analysisVideo.pause();
  });
}
analysisVideo.addEventListener('play', function () { setPlayLabel(true); setDrawMode(false); clearStrokes(); });
analysisVideo.addEventListener('pause', function () { setPlayLabel(false); });
analysisVideo.addEventListener('ended', function () { setPlayLabel(false); });
analysisVideo.addEventListener('loadedmetadata', function () { sizeDrawCanvas(); updateScrubUI(); });
analysisVideo.addEventListener('timeupdate', updateScrubUI);

function updateScrubUI() {
  if (!analysisVideo.duration) return;
  scrubBar.max = analysisVideo.duration;
  scrubBar.value = analysisVideo.currentTime;
  scrubTime.textContent = formatT(analysisVideo.currentTime) + ' / ' + formatT(analysisVideo.duration);
  highlightActiveNote();
}

if (stepBackBtn) {
  stepBackBtn.addEventListener('click', function () {
    analysisVideo.pause();
    analysisVideo.currentTime = Math.max(0, analysisVideo.currentTime - FRAME_STEP);
    clearStrokes(); resetPoseSmoothing();
  });
}
if (stepFwdBtn) {
  stepFwdBtn.addEventListener('click', function () {
    analysisVideo.pause();
    var dur = analysisVideo.duration || 0;
    analysisVideo.currentTime = Math.min(dur, analysisVideo.currentTime + FRAME_STEP);
    clearStrokes(); resetPoseSmoothing();
  });
}
speedBtns.forEach(function (btn) {
  btn.addEventListener('click', function () {
    analysisVideo.playbackRate = parseFloat(btn.getAttribute('data-speed'));
    speedBtns.forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});
if (scrubBar) {
  scrubBar.addEventListener('input', function () {
    analysisVideo.pause();
    analysisVideo.currentTime = parseFloat(scrubBar.value);
    clearStrokes(); resetPoseSmoothing();
  });
}

// ---- Drawing (line / freehand / angle) ----
function sizeDrawCanvas() {
  if (!drawCanvas || !analysisVideo.videoWidth) return;
  var vw = analysisVideo.videoWidth, vh = analysisVideo.videoHeight;
  var cw = analysisVideoWrap.clientWidth, ch = analysisVideoWrap.clientHeight;
  var videoAspect = vw / vh, boxAspect = cw / ch;
  var rw, rh, ox, oy;
  if (videoAspect > boxAspect) { rw = cw; rh = cw / videoAspect; ox = 0; oy = (ch - rh) / 2; }
  else { rh = ch; rw = ch * videoAspect; oy = 0; ox = (cw - rw) / 2; }
  [drawCanvas, poseCanvas].forEach(function (c) {
    if (!c) return;
    c.style.width = rw + 'px'; c.style.height = rh + 'px';
    c.style.left = ox + 'px'; c.style.top = oy + 'px';
    c.width = rw; c.height = rh;
  });
  redrawStrokes();
}
window.addEventListener('resize', sizeDrawCanvas);

function redrawStrokes() {
  if (!drawCtx) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  strokes.forEach(paintStroke);
  if (activeStroke) paintStroke(activeStroke);
  if (currentTool === 'angle' && anglePoints.length > 0) {
    drawCtx.fillStyle = currentColor;
    anglePoints.forEach(function (p) { drawCtx.beginPath(); drawCtx.arc(p.x, p.y, 4, 0, Math.PI * 2); drawCtx.fill(); });
    if (anglePoints.length === 2) {
      drawCtx.strokeStyle = currentColor; drawCtx.lineWidth = 3;
      drawCtx.beginPath(); drawCtx.moveTo(anglePoints[0].x, anglePoints[0].y); drawCtx.lineTo(anglePoints[1].x, anglePoints[1].y); drawCtx.stroke();
    }
  }
}

function paintStroke(s) {
  drawCtx.strokeStyle = s.color; drawCtx.lineWidth = 3; drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
  if (s.tool === 'line') {
    drawCtx.beginPath(); drawCtx.moveTo(s.x1, s.y1); drawCtx.lineTo(s.x2, s.y2); drawCtx.stroke();
  } else if (s.tool === 'angle') {
    var p0 = s.points[0], v = s.points[1], p2 = s.points[2];
    drawCtx.beginPath(); drawCtx.moveTo(v.x, v.y); drawCtx.lineTo(p0.x, p0.y); drawCtx.stroke();
    drawCtx.beginPath(); drawCtx.moveTo(v.x, v.y); drawCtx.lineTo(p2.x, p2.y); drawCtx.stroke();
    drawCtx.fillStyle = s.color; drawCtx.beginPath(); drawCtx.arc(v.x, v.y, 4, 0, Math.PI * 2); drawCtx.fill();
    var v1 = { x: p0.x - v.x, y: p0.y - v.y }, v2 = { x: p2.x - v.x, y: p2.y - v.y };
    var m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
    var deg = 0;
    if (m1 > 0 && m2 > 0) {
      var cosA = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
      deg = Math.round(Math.acos(cosA) * 180 / Math.PI);
    }
    drawCtx.font = 'bold 15px Inter, sans-serif';
    drawCtx.fillStyle = '#1A1D21'; drawCtx.fillText(deg + '°', v.x + 10, v.y - 10);
    drawCtx.fillStyle = s.color; drawCtx.fillText(deg + '°', v.x + 9, v.y - 11);
  } else {
    if (s.points.length < 2) return;
    drawCtx.beginPath(); drawCtx.moveTo(s.points[0].x, s.points[0].y);
    for (var i = 1; i < s.points.length; i++) drawCtx.lineTo(s.points[i].x, s.points[i].y);
    drawCtx.stroke();
  }
}

function clearStrokes() {
  strokes = []; activeStroke = null; anglePoints = [];
  if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function getCanvasPoint(evt) {
  var rect = drawCanvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

function setDrawMode(on) {
  drawMode = on; anglePoints = [];
  if (drawToggleBtn) drawToggleBtn.classList.toggle('active', on);
  if (drawToolbar) drawToolbar.style.display = on ? 'flex' : 'none';
  if (drawCanvas) drawCanvas.classList.toggle('drawing-active', on);
  if (on) { analysisVideo.pause(); sizeDrawCanvas(); }
}
if (drawToggleBtn) drawToggleBtn.addEventListener('click', function () { setDrawMode(!drawMode); });

if (drawCanvas) {
  drawCanvas.addEventListener('pointerdown', function (evt) {
    if (!drawMode) return;
    var p = getCanvasPoint(evt);
    if (currentTool === 'angle') {
      anglePoints.push(p);
      if (anglePoints.length === 3) { strokes.push({ tool: 'angle', color: currentColor, points: anglePoints.slice() }); anglePoints = []; }
      redrawStrokes(); return;
    }
    isDrawing = true;
    activeStroke = currentTool === 'line'
      ? { tool: 'line', color: currentColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
      : { tool: 'freehand', color: currentColor, points: [p] };
    drawCanvas.setPointerCapture(evt.pointerId);
  });
  drawCanvas.addEventListener('pointermove', function (evt) {
    if (!drawMode || !isDrawing || !activeStroke) return;
    var p = getCanvasPoint(evt);
    if (currentTool === 'line') { activeStroke.x2 = p.x; activeStroke.y2 = p.y; } else { activeStroke.points.push(p); }
    redrawStrokes();
  });
  function endStroke() { if (!isDrawing) return; isDrawing = false; if (activeStroke) { strokes.push(activeStroke); activeStroke = null; } redrawStrokes(); }
  drawCanvas.addEventListener('pointerup', endStroke);
  drawCanvas.addEventListener('pointerleave', endStroke);
}
toolBtns.forEach(function (btn) {
  btn.addEventListener('click', function () {
    currentTool = btn.getAttribute('data-tool');
    toolBtns.forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    anglePoints = []; redrawStrokes();
  });
});
colorSwatches.forEach(function (btn) {
  btn.addEventListener('click', function () {
    currentColor = btn.getAttribute('data-color');
    colorSwatches.forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});
if (clearDrawBtn) clearDrawBtn.addEventListener('click', clearStrokes);

// ---- Flip ----
if (flipToggleBtn) {
  flipToggleBtn.addEventListener('click', function () {
    if (drawMode) { setDrawMode(false); clearStrokes(); }
    if (poseActive) stopPoseOverlay();
    analysisVideo.classList.toggle('flipped');
    flipToggleBtn.classList.toggle('active');
  });
}

// ---- Guide lines ----
function makeGuideDraggable(el, axis) {
  var dragging = false;
  el.addEventListener('pointerdown', function (evt) { dragging = true; el.classList.add('dragging'); el.setPointerCapture(evt.pointerId); });
  el.addEventListener('pointermove', function (evt) {
    if (!dragging) return;
    var rect = analysisVideoWrap.getBoundingClientRect();
    if (axis === 'x') { var pct = ((evt.clientX - rect.left) / rect.width) * 100; el.style.left = Math.max(0, Math.min(100, pct)) + '%'; }
    else { var pctY = ((evt.clientY - rect.top) / rect.height) * 100; el.style.top = Math.max(0, Math.min(100, pctY)) + '%'; }
  });
  function endDrag() { dragging = false; el.classList.remove('dragging'); }
  el.addEventListener('pointerup', endDrag); el.addEventListener('pointercancel', endDrag);
}
if (guideV) makeGuideDraggable(guideV, 'x');
if (guideH) makeGuideDraggable(guideH, 'y');
if (guideToggleBtn) {
  guideToggleBtn.addEventListener('click', function () {
    var showing = guideV.style.display !== 'none';
    guideV.style.display = showing ? 'none' : 'block';
    guideH.style.display = showing ? 'none' : 'block';
    guideToggleBtn.classList.toggle('active', !showing);
  });
}

// ---- AI Pose Overlay ----
var poseDetector = null, poseActive = false, poseLoopHandle = null, poseLoading = false;
var POSE_CONNECTIONS = [
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
];
async function ensurePoseDetector() {
  if (poseDetector) return poseDetector;
  await tf.ready();
  poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER });
  return poseDetector;
}
var smoothedKeypoints = {};
var SMOOTHING = 0.25;
function smoothKeypoints(raw) {
  raw.forEach(function (kp) {
    var prev = smoothedKeypoints[kp.name];
    if (!prev) smoothedKeypoints[kp.name] = { x: kp.x, y: kp.y, score: kp.score };
    else {
      var alpha = Math.max(0.04, SMOOTHING * kp.score);
      prev.x += (kp.x - prev.x) * alpha; prev.y += (kp.y - prev.y) * alpha; prev.score += (kp.score - prev.score) * 0.3;
    }
  });
  return Object.keys(smoothedKeypoints).map(function (n) { var k = smoothedKeypoints[n]; return { name: n, x: k.x, y: k.y, score: k.score }; });
}
function resetPoseSmoothing() { smoothedKeypoints = {}; }
function drawSkeleton(keypoints) {
  if (!poseCtx) return;
  poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  var vw = analysisVideo.videoWidth, vh = analysisVideo.videoHeight;
  if (!vw || !vh) return;
  var sx = poseCanvas.width / vw, sy = poseCanvas.height / vh;
  var byName = {}; keypoints.forEach(function (kp) { byName[kp.name] = kp; });
  poseCtx.strokeStyle = '#39E58C'; poseCtx.lineWidth = 3;
  POSE_CONNECTIONS.forEach(function (pair) {
    var a = byName[pair[0]], b = byName[pair[1]];
    if (a && b && a.score > 0.25 && b.score > 0.25) { poseCtx.beginPath(); poseCtx.moveTo(a.x * sx, a.y * sy); poseCtx.lineTo(b.x * sx, b.y * sy); poseCtx.stroke(); }
  });
  poseCtx.fillStyle = '#E0A526';
  keypoints.forEach(function (kp) { if (kp.score > 0.25) { poseCtx.beginPath(); poseCtx.arc(kp.x * sx, kp.y * sy, 4, 0, Math.PI * 2); poseCtx.fill(); } });
}
async function poseLoop() {
  if (!poseActive || !poseDetector) return;
  try {
    var poses = await poseDetector.estimatePoses(analysisVideo, { flipHorizontal: false });
    if (poses && poses[0]) drawSkeleton(smoothKeypoints(poses[0].keypoints));
    else if (poseCtx) poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  } catch (e) {}
  poseLoopHandle = requestAnimationFrame(poseLoop);
}
function stopPoseOverlay() {
  poseActive = false; resetPoseSmoothing();
  if (poseLoopHandle) cancelAnimationFrame(poseLoopHandle);
  if (poseCtx) poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  if (poseToggleBtn) { poseToggleBtn.classList.remove('active'); poseToggleBtn.textContent = '🦴 AI Pose'; }
}
if (poseToggleBtn) {
  poseToggleBtn.addEventListener('click', async function () {
    if (poseLoading) return;
    if (poseActive) { stopPoseOverlay(); return; }
    if (drawMode) { setDrawMode(false); clearStrokes(); }
    if (analysisVideo.classList.contains('flipped')) { analysisVideo.classList.remove('flipped'); if (flipToggleBtn) flipToggleBtn.classList.remove('active'); }
    poseLoading = true; poseToggleBtn.classList.add('loading'); poseToggleBtn.textContent = 'Loading model…';
    try {
      await ensurePoseDetector(); sizeDrawCanvas();
      poseActive = true; poseToggleBtn.classList.add('active'); poseToggleBtn.textContent = '🦴 Hide Pose'; poseLoop();
    } catch (e) {
      poseToggleBtn.textContent = "Couldn't load model";
      setTimeout(function () { poseToggleBtn.textContent = '🦴 AI Pose'; }, 2500);
    }
    poseLoading = false; poseToggleBtn.classList.remove('loading');
  });
}

// ---- Export frame ----
if (exportFrameBtn) {
  exportFrameBtn.addEventListener('click', function () {
    var vw = analysisVideo.videoWidth, vh = analysisVideo.videoHeight;
    if (!vw || !vh) return;
    var out = document.createElement('canvas'); out.width = vw; out.height = vh;
    var octx = out.getContext('2d');
    octx.drawImage(analysisVideo, 0, 0, vw, vh);
    if (drawCanvas.width) octx.drawImage(drawCanvas, 0, 0, drawCanvas.width, drawCanvas.height, 0, 0, vw, vh);
    if (poseActive && poseCanvas.width) octx.drawImage(poseCanvas, 0, 0, poseCanvas.width, poseCanvas.height, 0, 0, vw, vh);
    var link = document.createElement('a');
    link.download = 'swing-breakdown-' + activeView + '.png';
    link.href = out.toDataURL('image/png');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  });
}

// ---- Dynamic text notes (coach types them in, tied to current timestamp) ----
var noteCounter = 0;
function addTextNote(text, atTime) {
  noteCounter++;
  var item = document.createElement('div');
  item.className = 'note-item';
  item.innerHTML =
    '<button class="seek-note" type="button">▶</button>' +
    '<span class="ts">' + formatT(atTime) + '</span>' +
    '<span class="note-text">' + text.replace(/</g, '&lt;') + '</span>' +
    '<button class="remove-note" type="button">&times;</button>';
  item.dataset.t = atTime;
  notesList.appendChild(item);
  item.querySelector('.seek-note').addEventListener('click', function () {
    analysisVideo.currentTime = atTime; resetPoseSmoothing(); analysisVideo.play();
  });
  item.querySelector('.remove-note').addEventListener('click', function () { notesList.removeChild(item); });
}
document.getElementById('addNoteBtn').addEventListener('click', function () {
  var input = document.getElementById('newNoteText');
  var text = input.value.trim();
  if (!text) return;
  addTextNote(text, analysisVideo.currentTime);
  input.value = '';
});
function highlightActiveNote() {
  var t = analysisVideo.currentTime;
  Array.prototype.forEach.call(notesList.children, function (item) {
    var bt = parseFloat(item.dataset.t);
    item.style.borderLeftColor = Math.abs(t - bt) < 0.15 ? '#12805C' : '#E0A526';
  });
}

// ---- Voice notes ----
var voiceRecordBtn = document.getElementById('voiceRecordBtn');
var voiceStatus = document.getElementById('voiceStatus');
var voiceNotesList = document.getElementById('voiceNotesList');
var activeMediaRecorder = null, recordedChunks = [], isRecording = false;
var recordStartMs = 0, recordStartVideoTime = 0, recordTimerHandle = null, voiceNoteCounter = 0, activeStream = null;

async function startVoiceRecording() {
  try { activeStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { voiceStatus.textContent = "Couldn't access the microphone."; return; }
  recordedChunks = [];
  try { activeMediaRecorder = new MediaRecorder(activeStream); }
  catch (e) { voiceStatus.textContent = 'Voice recording not supported here.'; activeStream.getTracks().forEach(function (t) { t.stop(); }); return; }
  activeMediaRecorder.addEventListener('dataavailable', function (e) { if (e.data && e.data.size > 0) recordedChunks.push(e.data); });
  activeMediaRecorder.addEventListener('stop', function () {
    var blob = new Blob(recordedChunks, { type: 'audio/webm' });
    addVoiceNote(URL.createObjectURL(blob), recordStartVideoTime);
    activeStream.getTracks().forEach(function (t) { t.stop(); });
  });
  recordStartVideoTime = analysisVideo.currentTime; recordStartMs = Date.now();
  activeMediaRecorder.start(); isRecording = true;
  voiceRecordBtn.textContent = '⏹ Stop Recording'; voiceRecordBtn.classList.add('active'); voiceStatus.classList.add('recording');
  recordTimerHandle = setInterval(function () { voiceStatus.textContent = '● Recording… ' + Math.floor((Date.now() - recordStartMs) / 1000) + 's'; }, 250);
}
function stopVoiceRecording() {
  if (activeMediaRecorder && isRecording) activeMediaRecorder.stop();
  isRecording = false; clearInterval(recordTimerHandle);
  voiceRecordBtn.textContent = '🎙️ Record Voice Note'; voiceRecordBtn.classList.remove('active'); voiceStatus.classList.remove('recording'); voiceStatus.textContent = '';
}
function addVoiceNote(url, atTime) {
  voiceNoteCounter++;
  var item = document.createElement('div'); item.className = 'voice-note-item';
  item.innerHTML =
    '<span class="ts">' + formatT(atTime) + '</span>' +
    '<button class="voice-play-btn" type="button">▶</button>' +
    '<audio class="voice-audio" src="' + url + '"></audio>' +
    '<span class="voice-note-label">Voice note ' + voiceNoteCounter + '</span>' +
    '<button class="remove-voice" type="button">&times;</button>';
  voiceNotesList.appendChild(item);
  var audioEl = item.querySelector('.voice-audio'), playBtn = item.querySelector('.voice-play-btn');
  playBtn.addEventListener('click', function () { analysisVideo.currentTime = atTime; resetPoseSmoothing(); audioEl.currentTime = 0; audioEl.play(); analysisVideo.play(); });
  item.querySelector('.remove-voice').addEventListener('click', function () { audioEl.pause(); URL.revokeObjectURL(url); voiceNotesList.removeChild(item); });
}
if (voiceRecordBtn) voiceRecordBtn.addEventListener('click', function () { if (isRecording) stopVoiceRecording(); else startVoiceRecording(); });

// ---- Email / Call student ----
var emailStudentBtn = document.getElementById('emailStudentBtn');
var emailStatus = document.getElementById('emailStatus');
var callStudentBtn = document.getElementById('callStudentBtn');
var studentContact = document.getElementById('studentContact');

function updateStudentContact() {
  var name = document.getElementById('stName').value || '';
  var email = document.getElementById('stEmail').value || '';
  var phone = document.getElementById('stPhone').value || '';
  var parts = [];
  if (name) parts.push('<strong>' + name.trim() + '</strong>');
  if (email) parts.push(email.trim());
  if (phone) parts.push(phone.trim());
  studentContact.innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

if (emailStudentBtn) {
  emailStudentBtn.addEventListener('click', function () {
    var name = document.getElementById('stName').value.trim();
    var email = document.getElementById('stEmail').value.trim();
    if (!email) { emailStatus.textContent = 'No student email on file.'; return; }
    var subject = 'Your swing breakdown';
    var body = 'Hi ' + (name || 'there') + ',\n\nThanks for sending in your swing -- here is your personal breakdown:\n\n[Paste your recording link here]\n\nLet me know if you have any questions.\n';
    window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    emailStatus.textContent = 'Opening your email app…';
  });
}
if (callStudentBtn) {
  callStudentBtn.addEventListener('click', function () {
    var phone = document.getElementById('stPhone').value.trim();
    if (!phone) { emailStatus.textContent = 'No phone number on file.'; return; }
    window.location.href = 'tel:' + phone.replace(/[^\d+]/g, '');
  });
}

function resetAnalysisPlayer() {
  analysisVideo.pause(); analysisVideo.removeAttribute('src'); analysisVideo.currentTime = 0; analysisVideo.playbackRate = 1;
  speedBtns.forEach(function (b) { b.classList.remove('active'); });
  var oneX = document.querySelector('.speed-btn[data-speed="1"]'); if (oneX) oneX.classList.add('active');
  setPlayLabel(false); setDrawMode(false); clearStrokes();
  analysisVideo.classList.remove('flipped'); if (flipToggleBtn) flipToggleBtn.classList.remove('active');
  stopPoseOverlay();
  guideV.style.display = 'none'; guideH.style.display = 'none'; guideV.style.left = '50%'; guideH.style.top = '70%';
  if (guideToggleBtn) guideToggleBtn.classList.remove('active');
}

// ====================================================================
// SIDE-BY-SIDE COMPARISON
// ====================================================================
var compareVideoA = document.getElementById('compareVideoA');
var compareVideoB = document.getElementById('compareVideoB');
var comparePlayBtn = document.getElementById('comparePlayBtn');
var comparePlayIconSvg = document.getElementById('comparePlayIconSvg');
var comparePlayLabel = document.getElementById('comparePlayLabel');
var compareStepBackBtn = document.getElementById('compareStepBackBtn');
var compareStepFwdBtn = document.getElementById('compareStepFwdBtn');
var compareScrubBar = document.getElementById('compareScrubBar');
var compareScrubTime = document.getElementById('compareScrubTime');
var flipCompareABtn = document.getElementById('flipCompareABtn');
var flipCompareBBtn = document.getElementById('flipCompareBBtn');

function setComparePlayLabel(isPlaying) {
  comparePlayLabel.textContent = isPlaying ? 'Pause both' : 'Play both';
  comparePlayIconSvg.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14" fill="#1A1D21"/><rect x="14" y="5" width="4" height="14" fill="#1A1D21"/>'
    : '<path d="M8 5v14l11-7-11-7z" fill="#1A1D21"/>';
}
function updateCompareScrubUI() {
  if (!compareVideoA.duration) return;
  compareScrubBar.max = compareVideoA.duration; compareScrubBar.value = compareVideoA.currentTime;
  compareScrubTime.textContent = formatT(compareVideoA.currentTime) + ' / ' + formatT(compareVideoA.duration);
}
compareVideoA.addEventListener('loadedmetadata', updateCompareScrubUI);
compareVideoA.addEventListener('timeupdate', function () {
  updateCompareScrubUI();
  if (Math.abs(compareVideoB.currentTime - compareVideoA.currentTime) > 0.08) compareVideoB.currentTime = compareVideoA.currentTime;
});
compareVideoA.addEventListener('play', function () { compareVideoB.play(); setComparePlayLabel(true); });
compareVideoA.addEventListener('pause', function () { compareVideoB.pause(); setComparePlayLabel(false); });
compareVideoA.addEventListener('ended', function () { compareVideoB.pause(); setComparePlayLabel(false); });
if (comparePlayBtn) comparePlayBtn.addEventListener('click', function () { if (compareVideoA.paused) compareVideoA.play(); else compareVideoA.pause(); });
if (compareStepBackBtn) compareStepBackBtn.addEventListener('click', function () { compareVideoA.pause(); var t = Math.max(0, compareVideoA.currentTime - FRAME_STEP); compareVideoA.currentTime = t; compareVideoB.currentTime = t; });
if (compareStepFwdBtn) compareStepFwdBtn.addEventListener('click', function () { compareVideoA.pause(); var dur = compareVideoA.duration || 0; var t = Math.min(dur, compareVideoA.currentTime + FRAME_STEP); compareVideoA.currentTime = t; compareVideoB.currentTime = t; });
if (compareScrubBar) compareScrubBar.addEventListener('input', function () { compareVideoA.pause(); var t = parseFloat(compareScrubBar.value); compareVideoA.currentTime = t; compareVideoB.currentTime = t; });
if (flipCompareABtn) flipCompareABtn.addEventListener('click', function () { compareVideoA.classList.toggle('flipped'); });
if (flipCompareBBtn) flipCompareBBtn.addEventListener('click', function () { compareVideoB.classList.toggle('flipped'); });

function resetComparePlayer() {
  compareVideoA.pause(); compareVideoB.pause();
  compareVideoA.removeAttribute('src'); compareVideoB.removeAttribute('src');
  compareVideoA.classList.remove('flipped'); compareVideoB.classList.remove('flipped');
  setComparePlayLabel(false);
}
