'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];  // top → bottom (high → low)
const FRET_COUNT   = 24;
const STRING_COUNT = 6;
const SINGLE_DOTS  = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOTS  = [12, 24];

// Canvas layout
const LEFT   = 52;   // px — string label area
const TOP    = 36;   // px — fret number area
const RIGHT  = 14;   // px
const BOTTOM = 12;   // px
const OPEN_W = 42;   // px — open-string click zone width
const NUT_W  = 5;    // px — nut width

// Visuals
const STRING_WIDTHS = [1, 1, 1.5, 1.8, 2.2, 2.6];   // e B G D A E
const STRING_COLORS = [
  '#c8b46a', '#c8b46a', '#c8b46a',   // plain (e B G)
  '#9ab0c0', '#9ab0c0', '#9ab0c0',   // wound (D A E)
];

const COL = {
  woodBg:     '#1c0e00',
  woodEdge:   '#2a1500',
  fretMetal:  '#a08060',
  nut:        '#ddd0a0',
  dot:        '#c8a060',
  hover:      'rgba(255, 220, 80, 0.10)',
  noteActive: '#e06030',
  noteGlow:   'rgba(220, 90, 40, 0.28)',
  noteText:   '#ffffff',
  fretLabel:  '#a08060',
  strLabel:   '#888',
};

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  columns:     [{ _dur: 'quarter' }], // each column: { [stringIndex]: fretNumber, _dur }
  currentCol:  0,
  hover:       null,
  selectedDur: 'quarter',             // duration applied to new columns
  lastPick:    'up',                  // last added pick direction; next will be opposite
  techMode:    null,                  // null | 'hammer' | 'pull'
  slideMode:   false,                 // straight-line slide between notes
  bendMode:    null,                  // null | '1/2' | 'full'
  vibMode:     false,                 // vibrato squiggle above note
  eightvaMode:  false,                // 8va — play notes one octave higher
  tripletMode:  false,                // group notes in triplets

};

// ─── Canvas & Layout ──────────────────────────────────────────────────────────

const canvas = document.getElementById('fretboard');
const ctx    = canvas.getContext('2d');

// Computed layout — set once via initLayout()
let FRET_POSITIONS = [];  // FRET_POSITIONS[n] = px offset from nut to right edge of fret n
let STR_GAP = 0;
let pickHitTargets = []; // populated each renderTab(); used by tab-canvas click handler

function initLayout() {
  const totalW  = canvas.width - LEFT - OPEN_W - NUT_W - RIGHT;
  const endFrac = 1 - Math.pow(0.5, FRET_COUNT / 12); // ≈ 0.75 for 24 frets
  FRET_POSITIONS = [];
  for (let i = 0; i <= FRET_COUNT; i++) {
    FRET_POSITIONS.push(totalW * (1 - Math.pow(0.5, i / 12)) / endFrac);
  }
  STR_GAP = (canvas.height - TOP - BOTTOM) / (STRING_COUNT - 1);
}

// ─── Coordinate Helpers ───────────────────────────────────────────────────────

function stringY(s) {
  return TOP + s * STR_GAP;
}

/** X-centre of a fret's cell (0 = open zone). */
function fretCenterX(fret) {
  if (fret === 0) return LEFT + OPEN_W / 2;
  return LEFT + OPEN_W + NUT_W + (FRET_POSITIONS[fret - 1] + FRET_POSITIONS[fret]) / 2;
}

/** Left edge of a fret's clickable zone. */
function fretLeftX(fret) {
  if (fret === 0) return LEFT;
  return LEFT + OPEN_W + NUT_W + FRET_POSITIONS[fret - 1];
}

/** Width of a fret's clickable zone. */
function fretZoneW(fret) {
  if (fret === 0) return OPEN_W;
  return FRET_POSITIONS[fret] - FRET_POSITIONS[fret - 1];
}

/** Map a canvas position to { string, fret } or null. */
function hitTest(x, y) {
  // Fret
  let fret;
  if (x >= LEFT && x < LEFT + OPEN_W) {
    fret = 0;
  } else if (x >= LEFT + OPEN_W + NUT_W) {
    const px = x - LEFT - OPEN_W - NUT_W;
    fret = FRET_POSITIONS.findIndex(pos => pos >= px);
    if (fret < 1 || fret > FRET_COUNT) return null;
  } else {
    return null; // on the nut itself
  }

  // String — nearest within half a gap
  const rawS  = (y - TOP) / STR_GAP;
  const s     = Math.round(rawS);
  if (s < 0 || s >= STRING_COUNT) return null;
  if (Math.abs(y - stringY(s)) > STR_GAP * 0.55) return null;

  return { string: s, fret };
}

/** Raw canvas position from a mouse event, accounting for CSS scaling. */
function canvasPos(e) {
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function draw() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  drawWood(W, H);
  drawHover();
  drawPositionDots();
  drawFretLines(H);
  drawNut(H);
  drawStrings(W);
  drawFretNumbers();
  drawStringLabels();
  drawNotes();
}

function drawWood(W, H) {
  // Main board
  const x0 = LEFT + OPEN_W;
  const y0 = TOP - 8;
  const bW  = W - x0 - RIGHT;
  const bH  = H - y0 - BOTTOM + 8;

  ctx.fillStyle = COL.woodBg;
  ctx.fillRect(x0, y0, bW, bH);

  // Subtle side rails
  ctx.fillStyle = COL.woodEdge;
  ctx.fillRect(x0, y0,    bW, 3);
  ctx.fillRect(x0, y0 + bH - 3, bW, 3);
}

function drawHover() {
  const h = state.hover;
  if (!h) return;

  const x = fretLeftX(h.fret);
  const y = stringY(h.string) - STR_GAP * 0.42;
  const w = fretZoneW(h.fret);
  const ht = STR_GAP * 0.84;

  ctx.fillStyle = COL.hover;
  ctx.fillRect(x, y, w, ht);
}

function drawPositionDots() {
  const midY = TOP + (STRING_COUNT - 1) * STR_GAP / 2;
  ctx.fillStyle = COL.dot;

  SINGLE_DOTS.forEach(f => {
    ctx.beginPath();
    ctx.arc(fretCenterX(f), midY, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  DOUBLE_DOTS.forEach(f => {
    const cx = fretCenterX(f);
    [1.5, 3.5].forEach(n => {
      ctx.beginPath();
      ctx.arc(cx, TOP + n * STR_GAP, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function drawFretLines(H) {
  ctx.strokeStyle = COL.fretMetal;
  ctx.lineWidth   = 1.5;

  for (let f = 1; f <= FRET_COUNT; f++) {
    const x = Math.round(LEFT + OPEN_W + NUT_W + FRET_POSITIONS[f]) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, TOP - 6);
    ctx.lineTo(x, H - BOTTOM + 4);
    ctx.stroke();
  }
}

function drawNut(H) {
  const x = LEFT + OPEN_W;
  ctx.fillStyle = COL.nut;
  ctx.fillRect(x, TOP - 8, NUT_W, H - TOP - BOTTOM + 16);
}

function drawStrings(W) {
  for (let s = 0; s < STRING_COUNT; s++) {
    const y = Math.round(stringY(s)) + 0.5;
    ctx.strokeStyle = STRING_COLORS[s];
    ctx.lineWidth   = STRING_WIDTHS[s];
    ctx.beginPath();
    ctx.moveTo(LEFT,     y);
    ctx.lineTo(W - RIGHT, y);
    ctx.stroke();
  }
}

function drawFretNumbers() {
  ctx.fillStyle  = COL.fretLabel;
  ctx.font       = '11px monospace';
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'alphabetic';

  // Open zone
  ctx.fillText('0', fretCenterX(0), TOP - 17);

  for (let f = 1; f <= FRET_COUNT; f++) {
    if (fretZoneW(f) >= 12) {
      ctx.fillText(f, fretCenterX(f), TOP - 17);
    }
  }
}

function drawStringLabels() {
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 13px monospace';

  for (let s = 0; s < STRING_COUNT; s++) {
    ctx.fillStyle = STRING_COLORS[s];
    ctx.fillText(STRINGS[s], LEFT - 8, stringY(s));
  }
}

function drawNotes() {
  const col = state.columns[state.currentCol];

  Object.entries(col).forEach(([si, fret]) => {
    const s  = +si;
    const cx = fretCenterX(fret);
    const cy = stringY(s);
    const r  = 12;

    // Glow
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = COL.noteGlow;
    ctx.fill();

    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COL.noteActive;
    ctx.fill();
    ctx.strokeStyle = '#f08050';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle    = COL.noteText;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fret >= 10 ? 'bold 9px monospace' : 'bold 11px monospace';
    ctx.fillText(fret, cx, cy);
  });
}

// ─── Tab Generation (text, for clipboard) ────────────────────────────────────

function colWidths() {
  return state.columns.map(col => {
    const frets = Object.values(col);
    const maxLen = frets.length > 0
      ? Math.max(...frets.map(f => String(f).length))
      : 1;
    return maxLen + 1;
  });
}

function tabText() {
  const widths = colWidths();
  return STRINGS.map((name, s) => {
    const cells = state.columns.map((col, ci) => {
      const fret = col[s];
      const w    = widths[ci];
      return fret !== undefined ? String(fret).padEnd(w, '-') : '-'.repeat(w);
    });
    return `${name} |${cells.join('')}|`;
  }).join('\n');
}

// ─── Rendered Tab Canvas ──────────────────────────────────────────────────────

// Layout constants (logical px, before DPR scaling)
const TL = {
  lineH:      18,   // gap between tab staff lines
  padV:       52,   // vertical padding above/below each system
  padH:       30,   // horizontal margin left & right
  clefW:      54,   // width of clef area (shared by both staves)
  lead:       12,   // space after opening barline
  trail:      12,   // space before closing barline
  colW1:      30,   // column width for 1-digit frets
  colW2:      42,   // column width for 2-digit frets
  // Music staff
  musicLineH: 12,   // gap between music staff lines (4 gaps = 5 lines)
  staveGap:   90,   // gap between bottom of music staff and top of tab staff
                    // must be large enough for ledger lines of low notes
};

const PAPER  = '#fafaf8';
const INK    = '#111111';
const INK_DIM = '#aaaaaa';
const CUR_BG  = 'rgba(210, 80, 20, 0.06)';
const CUR_INK = '#c04010';

function tabColW(col) {
  if (col._break)   return 0;
  if (col._barline) return 12;
  const hasTwoDigit = Object.entries(col).some(([k, v]) => !k.startsWith('_') && String(v).length >= 2);
  const base = hasTwoDigit ? TL.colW2 : TL.colW1;
  return col._triplet ? Math.round(base * 0.75) : base;
}

// ─── Music Notation Helpers ───────────────────────────────────────────────────

// Standard tuning MIDI (sounding pitch): e B G D A E
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];

// Guitar notation is written one octave higher than it sounds (guitar/8va clef).
// Add 12 so notes land sensibly on the treble staff instead of drowning in ledger lines.
const GUITAR_8VA = 12;

// Chromatic pitch class (0=C) → diatonic step within octave (C=0, D=1, …, B=6)
const PC_TO_DIAT = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

// Which pitch classes require a sharp sign
const PC_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

// Diatonic steps from C0 to E4 (bottom staff line in treble clef)
//   E4 → oct=4, diat-in-oct=2  →  4*7+2 = 30
const E4_DIAT = 30;

/** Guitar fret → staff step (0 = E4 bottom line, +1 per half-space up). */
function fretToStep(stringIdx, fret) {
  const midi = OPEN_MIDI[stringIdx] + fret + GUITAR_8VA;
  const pc   = ((midi % 12) + 12) % 12;
  const oct  = Math.floor(midi / 12) - 1;
  return oct * 7 + PC_TO_DIAT[pc] - E4_DIAT;
}

/** Staff step → canvas Y.  staffBotY = Y of the E4 (bottom) line. */
function stepY(step, staffBotY, lineH) {
  return staffBotY - step * lineH / 2;
}

/** Steps that need a ledger line drawn for a note at `step`. */
function ledgerSteps(step) {
  const out = [];
  if (step <= -2) {
    const floor = step % 2 === 0 ? step : step + 1;
    for (let s = -2; s >= floor; s -= 2) out.push(s);
  } else if (step >= 10) {
    const ceil = step % 2 === 0 ? step : step - 1;
    for (let s = 10; s <= ceil; s += 2) out.push(s);
  }
  return out;
}

// ── Shared note-drawing primitives ───────────────────────────────────────────

/** Collect { step, pc } for every fretted string in a column. */
function getColNotes(col, extraSemitones = 0) {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const fret = col[s];
    if (fret === undefined) continue;
    const midi = OPEN_MIDI[s] + fret + GUITAR_8VA + extraSemitones;
    const pc   = ((midi % 12) + 12) % 12;
    const oct  = Math.floor(midi / 12) - 1;
    const step = oct * 7 + PC_TO_DIAT[pc] - E4_DIAT;
    out.push({ step, pc });
  }
  return out;
}

/** Semitones added by a bend. */
function bendSemitones(bend) {
  return bend === 'full' ? 2 : bend === '1/2' ? 1 : 0;
}

/**
 * Draw a grace note (small, with stem + slash) at ncx for the given notes.
 * Used to show the pre-bend pitch before a bent main note.
 */
function drawGraceNote(cx, ncx, notes, botY, lineH, ink) {
  if (notes.length === 0) return;
  const scale  = 0.62;
  const nhW    = lineH * 1.1 * scale;
  const nhH    = lineH * 0.72 * scale;
  const avgStep = notes.reduce((a, n) => a + n.step, 0) / notes.length;
  const stemUp  = avgStep <= 4;
  const stemX   = ncx + (stemUp ? nhW * 0.43 : -nhW * 0.43);
  const stemLen = lineH * 3.5 * 0.3;   // 30% of normal stem length
  const minStep = Math.min(...notes.map(n => n.step));
  const maxStep = Math.max(...notes.map(n => n.step));
  const anchorY = stepY(stemUp ? minStep : maxStep, botY, lineH);
  const tipY    = stepY(stemUp ? maxStep : minStep, botY, lineH) + (stemUp ? -stemLen : stemLen);

  // Stem
  cx.strokeStyle = ink;
  cx.lineWidth   = 0.75;
  cx.beginPath();
  cx.moveTo(stemX, anchorY);
  cx.lineTo(stemX, tipY);
  cx.stroke();

  // Slash across the stem (acciaccatura style)
  cx.lineWidth = 0.75;
  cx.beginPath();
  cx.moveTo(stemX - 3, tipY + 6);
  cx.lineTo(stemX + 3, tipY - 2);
  cx.stroke();

  // Note heads (smaller)
  notes.forEach(({ step, pc }) => {
    const ny = stepY(step, botY, lineH);

    if (PC_SHARP[pc]) {
      const sz = Math.max(7, Math.round(lineH * 0.8));
      cx.font         = `bold ${sz}px Georgia, serif`;
      cx.fillStyle    = ink;
      cx.textAlign    = 'right';
      cx.textBaseline = 'middle';
      cx.fillText('♯', ncx - nhW / 2 - 1, ny + 1);
    }

    cx.fillStyle = ink;
    cx.save();
    cx.translate(ncx, ny);
    cx.rotate(-Math.PI / 9);
    cx.beginPath();
    cx.ellipse(0, 0, nhW / 2, nhH / 2, 0, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  });
}

/** Draw note heads, ledger lines and accidentals for a set of notes at x = ncx. */
function drawNoteHeads(cx, ncx, notes, botY, lineH, ink) {
  const nhW = lineH * 1.1;
  const nhH = lineH * 0.72;
  const drawnLedgers = new Set();

  notes.forEach(({ step, pc }) => {
    const ny = stepY(step, botY, lineH);

    ledgerSteps(step).forEach(ls => {
      if (drawnLedgers.has(ls)) return;
      drawnLedgers.add(ls);
      const ly = stepY(ls, botY, lineH);
      cx.strokeStyle = INK;
      cx.lineWidth   = 0.8;
      cx.beginPath();
      cx.moveTo(ncx - nhW / 2 - 4, ly + 0.5);
      cx.lineTo(ncx + nhW / 2 + 4, ly + 0.5);
      cx.stroke();
    });

    if (PC_SHARP[pc]) {
      const sz = Math.max(9, Math.round(lineH * 1.05));
      cx.font         = `bold ${sz}px Georgia, serif`;
      cx.fillStyle    = ink;
      cx.textAlign    = 'right';
      cx.textBaseline = 'middle';
      cx.fillText('♯', ncx - nhW / 2 - 2, ny + 1);
    }

    cx.fillStyle = ink;
    cx.save();
    cx.translate(ncx, ny);
    cx.rotate(-Math.PI / 9);
    cx.beginPath();
    cx.ellipse(0, 0, nhW / 2, nhH / 2, 0, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  });
}

/** Draw a single note column (with flags for isolated 16th notes). */
function drawMusicNotes(cx, col, noteCx, botY, lineH, isCurrent) {
  const octShift = col._8va ? -12 : 0;
  const semi     = bendSemitones(col._bend) + octShift;
  const notes    = getColNotes(col, semi);
  if (notes.length === 0) return;

  const ink = isCurrent ? CUR_INK : INK;

  // Grace note at original pitch (with octave shift if 8va) if bent
  if (col._bend) {
    const graceOff = lineH * 1.1;
    drawGraceNote(cx, noteCx - graceOff, getColNotes(col, octShift), botY, lineH, ink);
  }
  const nhW      = lineH * 1.1;
  const avgStep  = notes.reduce((a, n) => a + n.step, 0) / notes.length;
  const stemUp   = avgStep <= 4;
  const stemXOff = stemUp ? nhW * 0.43 : -nhW * 0.43;
  const stemLen  = lineH * 3.5;
  const minStep  = Math.min(...notes.map(n => n.step));
  const maxStep  = Math.max(...notes.map(n => n.step));
  const anchorY  = stepY(stemUp ? minStep : maxStep, botY, lineH);
  const farY     = stepY(stemUp ? maxStep : minStep, botY, lineH);
  const tipY     = farY + (stemUp ? -stemLen : stemLen);

  cx.strokeStyle = ink;
  cx.lineWidth   = 1.1;
  cx.beginPath();
  cx.moveTo(noteCx + stemXOff, anchorY);
  cx.lineTo(noteCx + stemXOff, tipY);
  cx.stroke();

  const dur = col._dur || 'quarter';
  if (dur === 'eighth')    drawFlags(cx, noteCx + stemXOff, tipY, stemUp, 1, lineH, ink);
  if (dur === 'sixteenth') drawFlags(cx, noteCx + stemXOff, tipY, stemUp, 2, lineH, ink);

  drawNoteHeads(cx, noteCx, notes, botY, lineH, ink);
}

// ── Beamed group rendering ────────────────────────────────────────────────────

/**
 * Draw a run of consecutive beamed note columns.
 * beamCount: 1 for 8th notes, 2 for 16th notes.
 * items = [{ col, ncx, isCur }]
 */
function drawBeamedGroup(cx, items, botY, lineH, beamCount, isTriplet = false) {
  const nhW = lineH * 1.1;

  // Attach note arrays (use bent + octave-shifted pitch for stem/beam geometry)
  const cols = items.map(item => {
    const octShift = item.col._8va ? -12 : 0;
    return {
      ...item,
      notes:     getColNotes(item.col, bendSemitones(item.col._bend) + octShift),
      origNotes: getColNotes(item.col, octShift),
    };
  });

  // Group-wide stem direction from all notes combined
  const allSteps = cols.flatMap(c => c.notes.map(n => n.step));
  if (allSteps.length === 0) return;
  const avgStep  = allSteps.reduce((a, b) => a + b, 0) / allSteps.length;
  const stemUp   = avgStep <= 4;
  const stemXOff = stemUp ? nhW * 0.43 : -nhW * 0.43;
  const stemLen  = lineH * 3.5;

  // Per-column: anchor Y (note-head end of stem) and natural tip Y
  const enriched = cols.map(c => {
    const steps    = c.notes.map(n => n.step);
    const anchor   = stemUp ? Math.min(...steps) : Math.max(...steps);
    const far      = stemUp ? Math.max(...steps) : Math.min(...steps);
    const anchorY  = stepY(anchor, botY, lineH);
    const tipY     = stepY(far, botY, lineH) + (stemUp ? -stemLen : stemLen);
    return { ...c, anchorY, tipY, stemX: c.ncx + stemXOff };
  });

  // Beam Y: most extreme tip so no stem is shorter than its natural length
  const beamY = stemUp
    ? Math.min(...enriched.map(e => e.tipY))
    : Math.max(...enriched.map(e => e.tipY));

  const beamH   = Math.max(3, Math.round(lineH * 0.28));
  const beamGap = Math.max(3, Math.round(lineH * 0.24));
  const x0      = enriched[0].stemX;
  const x1      = enriched[enriched.length - 1].stemX;

  // Primary beam top, secondary beam top (16th = two beams)
  const b1Top = stemUp ? beamY                   : beamY - beamH;
  const b2Top = stemUp ? beamY + beamH + beamGap : beamY - 2 * beamH - beamGap;

  // Stems — stop exactly at the inner face of the primary beam
  enriched.forEach(e => {
    cx.strokeStyle = e.isCur ? CUR_INK : INK;
    cx.lineWidth   = 1.1;
    cx.beginPath();
    cx.moveTo(e.stemX, e.anchorY);
    cx.lineTo(e.stemX, stemUp ? b1Top : b1Top + beamH);
    cx.stroke();
  });

  // Solid beams (1 for 8th, 2 for 16th)
  cx.fillStyle = INK;
  cx.fillRect(x0 - 0.5, b1Top, x1 - x0 + 1, beamH);
  if (beamCount >= 2) cx.fillRect(x0 - 0.5, b2Top, x1 - x0 + 1, beamH);

  // Triplet number near the beam
  if (isTriplet) {
    const midX  = (enriched[0].stemX + enriched[enriched.length - 1].stemX) / 2;
    const markY = stemUp ? b1Top - 4 : beamY + 4;
    cx.font         = `bold 10px Georgia, serif`;
    cx.fillStyle    = INK;
    cx.textAlign    = 'center';
    cx.textBaseline = stemUp ? 'bottom' : 'top';
    cx.fillText('3', midX, markY);
  }

  // Note heads per column (grace note before main note if bent)
  enriched.forEach(e => {
    if (e.col._bend) {
      const graceOff = lineH * 1.1;
      drawGraceNote(cx, e.ncx - graceOff, e.origNotes, botY, lineH, e.isCur ? CUR_INK : INK);
    }
    drawNoteHeads(cx, e.ncx, e.notes, botY, lineH, e.isCur ? CUR_INK : INK);
  });
}

// ── Rest symbols ─────────────────────────────────────────────────────────────

/** Quarter rest — classic Z/squiggle shape, centred on the staff. */
function drawQuarterRest(cx, x, staffBotY, lineH, ink) {
  const sy = s => stepY(s, staffBotY, lineH);
  const w  = lineH;
  cx.strokeStyle = ink;
  cx.lineWidth   = 1.2;
  cx.lineCap     = 'round';
  cx.lineJoin    = 'round';

  cx.beginPath();
  // Top slanted stroke
  cx.moveTo(x - w * 0.20, sy(6.0));
  cx.lineTo(x + w * 0.50, sy(5.5));
  // Main diagonal down-left
  cx.lineTo(x - w * 0.45, sy(4.1));
  // Mid hook right
  cx.lineTo(x + w * 0.42, sy(3.75));
  // Lower curve sweeping right then curling back left
  cx.bezierCurveTo(x + w * 0.88, sy(3.45), x + w * 0.85, sy(2.65), x + w * 0.18, sy(2.35));
  cx.bezierCurveTo(x - w * 0.18, sy(2.15), x - w * 0.52, sy(2.38), x - w * 0.34, sy(2.65));
  cx.stroke();
}

/** Eighth rest — diagonal stem with one flagged dot. */
function drawEighthRest(cx, x, staffBotY, lineH, ink) {
  const sy = s => stepY(s, staffBotY, lineH);
  const w  = lineH;
  cx.strokeStyle = ink;
  cx.fillStyle   = ink;
  cx.lineCap     = 'round';

  // Diagonal stem
  cx.lineWidth = 1.1;
  cx.beginPath();
  cx.moveTo(x - w * 0.10, sy(2.8));
  cx.lineTo(x + w * 0.18, sy(5.8));
  cx.stroke();

  // Single dot with rightward flag at step 5.0
  const px = x + w * 0.10, py = sy(5.0);
  const r  = w * 0.26;
  cx.beginPath();
  cx.arc(px, py, r, 0, Math.PI * 2);
  cx.fill();
  cx.lineWidth = 1.0;
  cx.beginPath();
  cx.moveTo(px + r, py);
  cx.bezierCurveTo(px + w * 0.65, py + lineH * 0.10, px + w * 0.60, py + lineH * 0.52, px, py + lineH * 0.58);
  cx.stroke();
}

/** Sixteenth rest — diagonal stem with two flagged dots. */
function drawSixteenthRest(cx, x, staffBotY, lineH, ink) {
  const sy = s => stepY(s, staffBotY, lineH);
  const w  = lineH;
  cx.strokeStyle = ink;
  cx.fillStyle   = ink;
  cx.lineCap     = 'round';

  // Diagonal stem
  cx.lineWidth = 1.1;
  cx.beginPath();
  cx.moveTo(x - w * 0.15, sy(2.2));
  cx.lineTo(x + w * 0.20, sy(5.8));
  cx.stroke();

  // Two dots with rightward flags, at step 5.0 and step 3.4
  [[x + w * 0.10, sy(5.0)], [x - w * 0.04, sy(3.4)]].forEach(([px, py]) => {
    const r = w * 0.26;
    // Filled dot
    cx.beginPath();
    cx.arc(px, py, r, 0, Math.PI * 2);
    cx.fill();
    // Flag curving right then back down
    cx.lineWidth = 1.0;
    cx.beginPath();
    cx.moveTo(px + r, py);
    cx.bezierCurveTo(px + w * 0.65, py + lineH * 0.10, px + w * 0.60, py + lineH * 0.52, px, py + lineH * 0.58);
    cx.stroke();
  });
}

function drawRest(cx, x, staffBotY, lineH, dur, ink) {
  if (dur === 'quarter')    drawQuarterRest(cx, x, staffBotY, lineH, ink);
  else if (dur === 'eighth') drawEighthRest(cx, x, staffBotY, lineH, ink);
  else                      drawSixteenthRest(cx, x, staffBotY, lineH, ink);
}

/**
 * Draw a triplet bracket [ 3 ] above a run of quarter-note triplet columns.
 */
function drawTripletBracket(cx, run, botY, lineH) {
  const x0    = run[0].ncx;
  const x1    = run[run.length - 1].ncx;
  const midX  = (x0 + x1) / 2;
  const bY    = botY - lineH * 5.6;   // safely above stem tips for mid-range notes
  const legH  = 5;

  cx.strokeStyle = INK;
  cx.lineWidth   = 0.9;
  cx.lineCap     = 'round';
  cx.beginPath();
  cx.moveTo(x0 - 4, bY + legH);
  cx.lineTo(x0 - 4, bY);
  cx.lineTo(midX - 7, bY);
  cx.moveTo(midX + 7, bY);
  cx.lineTo(x1 + 4, bY);
  cx.lineTo(x1 + 4, bY + legH);
  cx.stroke();

  cx.font         = `bold 10px Georgia, serif`;
  cx.fillStyle    = INK;
  cx.textAlign    = 'center';
  cx.textBaseline = 'bottom';
  cx.fillText('3', midX, bY + 1);
}

/**
 * Render all music-staff notes for one system.
 * Detects consecutive 16th-note runs and routes them to drawBeamedGroup;
 * everything else goes to drawMusicNotes.
 */
function renderMusicNotes(cx, sys, staffX, musicTop, musicStaffH, cw) {
  const botY  = musicTop + musicStaffH;
  const lineH = TL.musicLineH;

  // Build per-column descriptors with pre-computed x centres
  const colData = [];
  let noteX = staffX + TL.lead;
  sys.indices.forEach(ci => {
    const col = state.columns[ci];
    const w   = cw[ci];
    colData.push({ ci, col, ncx: noteX + w / 2, dur: col._dur || 'quarter', isCur: ci === state.currentCol });
    noteX += w;
  });

  // Walk the columns, grouping consecutive 16th-note columns (with notes) for beaming
  let i = 0;
  while (i < colData.length) {
    const item     = colData[i];

    // ── Group-break / barline column (breaks beam grouping) ─────────
    if (item.col._break || item.col._barline) { i++; continue; }

    // ── Rest column ─────────────────────────────────────────────────
    if (item.col._rest) {
      drawRest(cx, item.ncx, botY, lineH, item.dur, item.isCur ? CUR_INK : INK);
      i++;
      continue;
    }

    const hasNotes = getColNotes(item.col).length > 0;

    if ((item.dur === 'eighth' || item.dur === 'sixteenth') && hasNotes) {
      const groupDur  = item.dur;
      const beams     = groupDur === 'sixteenth' ? 2 : 1;
      const isTriplet = !!item.col._triplet;
      const start     = i;
      while (i < colData.length &&
             colData[i].dur === groupDur &&
             !!colData[i].col._triplet === isTriplet &&
             !colData[i].col._break && !colData[i].col._barline && !colData[i].col._rest &&
             getColNotes(colData[i].col).length > 0) i++;
      const run = colData.slice(start, i);
      if (run.length >= 2) {
        drawBeamedGroup(cx, run, botY, lineH, beams, isTriplet);
      } else {
        drawMusicNotes(cx, run[0].col, run[0].ncx, botY, lineH, run[0].isCur);
        if (isTriplet) {
          // Isolated triplet — just draw the "3" above the note
          const notes = getColNotes(run[0].col, run[0].col._8va ? -12 : 0);
          if (notes.length > 0) {
            const topStep = Math.max(...notes.map(n => n.step));
            const tipY    = stepY(topStep, botY, lineH) - lineH * 3.5 - 4;
            cx.font = `bold 10px Georgia, serif`;
            cx.fillStyle = INK; cx.textAlign = 'center'; cx.textBaseline = 'bottom';
            cx.fillText('3', run[0].ncx, tipY);
          }
        }
      }
    } else if (item.dur === 'quarter' && hasNotes && item.col._triplet) {
      // Quarter-note triplet run — collect and draw bracket
      const start = i;
      while (i < colData.length &&
             colData[i].dur === 'quarter' &&
             colData[i].col._triplet &&
             !colData[i].col._break && !colData[i].col._barline && !colData[i].col._rest &&
             getColNotes(colData[i].col).length > 0) i++;
      const run = colData.slice(start, i);
      run.forEach(r => drawMusicNotes(cx, r.col, r.ncx, botY, lineH, r.isCur));
      drawTripletBracket(cx, run, botY, lineH);
    } else {
      if (hasNotes) drawMusicNotes(cx, item.col, item.ncx, botY, lineH, item.isCur);
      i++;
    }
  }
}

/**
 * Draw `count` flags from the stem tip.
 * Flags for stem-up notes curve right-and-down; stem-down curve right-and-up.
 */
function drawFlags(cx, stemX, tipY, stemUp, count, lineH, ink) {
  const fW      = lineH * 1.45;  // horizontal reach
  const fH      = lineH * 1.05;  // vertical drop / rise
  const spacing = lineH * 0.85;  // distance between successive flags

  cx.strokeStyle = ink;
  cx.lineWidth   = 1.9;          // thicker for modern look
  cx.lineCap     = 'round';

  for (let i = 0; i < count; i++) {
    const y0  = stemUp ? tipY + i * spacing : tipY - i * spacing;
    const dir = stemUp ? 1 : -1;
    cx.beginPath();
    cx.moveTo(stemX, y0);
    // Quadratic bezier: one control point pulls right, end lands back toward stem.
    // Less ornate than cubic — clean, modern engraving style.
    cx.quadraticCurveTo(stemX + fW, y0 + dir * fH * 0.38, stemX + fW * 0.55, y0 + dir * fH);
    cx.stroke();
  }
}

// ── Picking direction symbols ─────────────────────────────────────────────────

/** Downstroke: open-bottom square (⊓). cx/cy = centre of symbol. */
function drawDownstroke(ctx, x, y, ink) {
  const hw = 5.5;  // half-width
  const h  = 9;    // height
  ctx.strokeStyle = ink;
  ctx.lineWidth   = 1.6;
  ctx.lineCap     = 'square';
  ctx.lineJoin    = 'miter';
  ctx.beginPath();
  ctx.moveTo(x - hw, y + h * 0.5);   // bottom-left
  ctx.lineTo(x - hw, y - h * 0.5);   // top-left
  ctx.lineTo(x + hw, y - h * 0.5);   // top-right
  ctx.lineTo(x + hw, y + h * 0.5);   // bottom-right (open — no closing line)
  ctx.stroke();
}

/** Upstroke: V shape. cx/cy = centre of symbol. */
function drawUpstroke(ctx, x, y, ink) {
  const hw = 5.5;
  const h  = 9;
  ctx.strokeStyle = ink;
  ctx.lineWidth   = 1.6;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(x - hw, y - h * 0.5);   // top-left
  ctx.lineTo(x,      y + h * 0.5);   // bottom-centre
  ctx.lineTo(x + hw, y - h * 0.5);   // top-right
  ctx.stroke();
}

// ── Hammer-on / Pull-off arc ─────────────────────────────────────────────────

/**
 * Draw a slur arc between two tab notes, potentially on different strings.
 * x0/y0 = start note centre, x1/y1 = end note centre (top of fret number).
 * The control point is placed above both endpoints so the arc always bows upward.
 * label = 'H' or 'P'
 */
function drawTechArc(cx, x0, y0, x1, y1, label, ink) {
  const midX   = (x0 + x1) / 2;
  const span   = x1 - x0;
  const topY   = Math.min(y0, y1);
  const bulge  = Math.max(10, span * 0.42);
  const ctrlY  = topY - bulge;

  cx.strokeStyle = ink;
  cx.lineWidth   = 1.1;
  cx.lineCap     = 'round';
  cx.beginPath();
  cx.moveTo(x0 + 4, y0);
  cx.quadraticCurveTo(midX, ctrlY, x1 - 4, y1);
  cx.stroke();

  cx.font         = `bold 8px system-ui, sans-serif`;
  cx.fillStyle    = ink;
  cx.textAlign    = 'center';
  cx.textBaseline = 'bottom';
  cx.fillText(label, midX, ctrlY + 2);
}

// ── Slide line ───────────────────────────────────────────────────────────────

/**
 * Draw a straight slide line from the right edge of the previous fret number
 * to the left edge of the current fret number.
 * x0/y0 = prev note centre, x1/y1 = current note centre.
 * edgeOff = horizontal distance from note centre to the number's edge.
 */
function drawSlide(cx, x0, y0, x1, y1, edgeOff0, edgeOff1, ink) {
  const sx0 = x0 + edgeOff0;
  const sx1 = x1 - edgeOff1;
  const midX = (sx0 + sx1) / 2;
  const midY = (y0  + y1)  / 2;

  cx.strokeStyle = ink;
  cx.lineWidth   = 1.2;
  cx.lineCap     = 'round';
  cx.beginPath();
  cx.moveTo(sx0, y0);
  cx.lineTo(sx1, y1);
  cx.stroke();

  cx.font         = `bold 10px system-ui, sans-serif`;
  cx.fillStyle    = ink;
  cx.textAlign    = 'center';
  cx.textBaseline = 'bottom';
  cx.fillText('s', midX, midY - 1);
}

// ── Vibrato squiggle ─────────────────────────────────────────────────────────

/**
 * Draw a wavy vibrato line centred at (x, y).
 * 4 full wave cycles rendered as alternating quadratic bezier arcs.
 */
function drawVibrato(cx, x, y, ink) {
  const halfW  = 4;      // width of each half-cycle
  const amp    = 2.8;    // wave amplitude
  const halves = 8;      // 4 full cycles = 8 half-cycles
  const totalW = halves * halfW;
  const startX = x - totalW / 2;

  cx.strokeStyle = ink;
  cx.lineWidth   = 1.1;
  cx.lineCap     = 'round';
  cx.beginPath();
  cx.moveTo(startX, y);

  for (let i = 0; i < halves; i++) {
    const x0    = startX + i * halfW;
    const x1    = x0 + halfW;
    const ctrlY = y + (i % 2 === 0 ? -amp : amp);
    cx.quadraticCurveTo((x0 + x1) / 2, ctrlY, x1, y);
  }

  cx.stroke();
}

// ── Bend arrow ───────────────────────────────────────────────────────────────

/**
 * Draw an upward curved arrow with amount label ('1/2' or 'full') above it.
 * x/y = centre of the fret number in the tab staff.
 */
function drawBend(cx, x, y, amount, ink) {
  const startX  = x;
  const startY  = y - 7;         // just above the fret number
  const tipX    = x + 5;         // slight rightward lean at the top
  const tipY    = y - 30;        // how high the arrow goes
  const ctrlX   = x + 10;        // control point pulls arc rightward
  const ctrlY   = startY - 14;

  cx.strokeStyle = ink;
  cx.fillStyle   = ink;
  cx.lineWidth   = 1.3;
  cx.lineCap     = 'round';

  // Curved shaft
  cx.beginPath();
  cx.moveTo(startX, startY);
  cx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  cx.stroke();

  // Arrowhead at the tip (two short lines pointing back down)
  const aLen = 5;
  cx.lineWidth = 1.2;
  cx.beginPath();
  cx.moveTo(tipX, tipY);
  cx.lineTo(tipX - aLen, tipY + aLen);
  cx.moveTo(tipX, tipY);
  cx.lineTo(tipX + 2, tipY + aLen + 1);
  cx.stroke();

  // Label above the tip
  cx.font         = `bold 8px system-ui, sans-serif`;
  cx.textAlign    = 'center';
  cx.textBaseline = 'bottom';
  cx.fillText(amount, tipX, tipY - 2);
}

function renderTab() {
  const tc          = document.getElementById('tab-canvas');
  const wrap        = tc.parentElement;
  const dpr         = window.devicePixelRatio || 1;
  pickHitTargets    = [];
  const tabStaffH   = TL.lineH * 5;                                    // 90px
  const musicStaffH = TL.musicLineH * 4;                               // 32px
  const sysH        = TL.padV + musicStaffH + TL.staveGap + tabStaffH + TL.padV;

  const logW = wrap.clientWidth;
  if (logW === 0) return;

  const cw         = state.columns.map(tabColW);
  const noteAreaW  = logW - 2 * TL.padH - TL.clefW - TL.lead - TL.trail;

  // Pack columns into systems greedily
  const systems = [];
  let i = 0;
  while (i < state.columns.length) {
    const sys = { start: i, indices: [] };
    let used  = 0;
    while (i < state.columns.length) {
      if (used + cw[i] > noteAreaW && sys.indices.length > 0) break;
      used += cw[i];
      sys.indices.push(i);
      i++;
    }
    systems.push(sys);
  }

  const logH = systems.length * sysH + 24;

  // Size the canvas (HiDPI)
  tc.width        = Math.round(logW * dpr);
  tc.height       = Math.round(logH * dpr);
  tc.style.width  = logW + 'px';
  tc.style.height = logH + 'px';

  const cx = tc.getContext('2d');
  cx.scale(dpr, dpr);

  cx.fillStyle = PAPER;
  cx.fillRect(0, 0, logW, logH);

  // Build auto-alternating pick map: every pickable note (no H/P, no slide, has at least one fret)
  // gets alternating down/up unless the user has explicitly set _pick.
  const autoPick = {};
  let pickSeq = 0; // even = down, odd = up
  state.columns.forEach((col, ci) => {
    if (col._barline || col._break) return;
    const hasNote = Object.keys(col).some(k => !k.startsWith('_'));
    if (!hasNote) return;                          // rest — no symbol
    if (col._tech || col._slide) return;           // H/P or slide — no auto symbol
    if (col._pick === 'down' || col._pick === 'up') {
      // User-set pick: sync sequence so the next note gets the opposite direction
      pickSeq = col._pick === 'down' ? 1 : 0;
    } else {
      // Auto or explicitly suppressed ('none') — assign and advance
      autoPick[ci] = pickSeq % 2 === 0 ? 'down' : 'up';
      pickSeq++;
    }
  });

  systems.forEach((sys, si) => {
    const sysTop    = si * sysH + TL.padV;
    const musicTop  = sysTop;
    const tabTop    = sysTop + musicStaffH + TL.staveGap;
    const staffX    = TL.padH + TL.clefW;
    const staffW    = logW - 2 * TL.padH - TL.clefW;
    const isLast    = si === systems.length - 1;

    // ── Music staff (5 lines) ─────────────────────────────────────
    cx.strokeStyle = INK;
    cx.lineWidth   = 0.75;
    for (let l = 0; l < 5; l++) {
      const y = musicTop + l * TL.musicLineH + 0.5;
      cx.beginPath();
      cx.moveTo(staffX, y);
      cx.lineTo(staffX + staffW, y);
      cx.stroke();
    }

    // ── Treble clef ───────────────────────────────────────────────
    drawTrebleClef(cx, TL.padH + 4, musicTop, musicStaffH);

    // ── Tab staff (6 lines) ───────────────────────────────────────
    cx.strokeStyle = INK;
    cx.lineWidth   = 0.75;
    for (let s = 0; s < 6; s++) {
      const y = tabTop + s * TL.lineH + 0.5;
      cx.beginPath();
      cx.moveTo(staffX, y);
      cx.lineTo(staffX + staffW, y);
      cx.stroke();
    }

    // ── TAB clef ─────────────────────────────────────────────────
    const clefSz = Math.round(tabStaffH / 3 * 0.78);
    cx.font         = `bold ${clefSz}px Georgia, 'Times New Roman', serif`;
    cx.fillStyle    = INK;
    cx.textAlign    = 'center';
    cx.textBaseline = 'middle';
    const clefCx    = TL.padH + TL.clefW * 0.44;
    ['T', 'A', 'B'].forEach((letter, li) => {
      cx.fillText(letter, clefCx, tabTop + tabStaffH / 6 + li * (tabStaffH / 3));
    });

    // ── Left bracket connecting both staves ───────────────────────
    const bx = TL.padH - 2;
    cx.strokeStyle = INK;
    cx.lineWidth   = 2;
    cx.beginPath();
    cx.moveTo(bx + 0.5, musicTop);
    cx.lineTo(bx + 0.5, tabTop + tabStaffH);
    cx.stroke();

    // ── Bar lines spanning both staves ────────────────────────────
    cx.lineWidth = 1;
    const barTop = musicTop;
    const barBot = tabTop + tabStaffH;

    // Opening barline
    cx.beginPath();
    cx.moveTo(staffX + 0.5, barTop);
    cx.lineTo(staffX + 0.5, barBot);
    cx.stroke();

    // Closing barline
    cx.beginPath();
    cx.moveTo(staffX + staffW + 0.5, barTop);
    cx.lineTo(staffX + staffW + 0.5, barBot);
    cx.stroke();

    // Final double barline on last system
    if (isLast) {
      cx.lineWidth = 3;
      cx.beginPath();
      cx.moveTo(staffX + staffW + 5, barTop);
      cx.lineTo(staffX + staffW + 5, barBot);
      cx.stroke();
      cx.lineWidth = 1;
    }

    // ── Current-column highlight spans both staves ────────────────
    let noteX = staffX + TL.lead;
    sys.indices.forEach(ci => {
      const w         = cw[ci];
      const isCurrent = ci === state.currentCol;

      if (isCurrent) {
        cx.fillStyle = CUR_BG;
        cx.fillRect(noteX - 1, barTop, w + 2, barBot - barTop);
        // Thin accent stripe at top
        cx.fillStyle = 'rgba(200, 70, 10, 0.5)';
        cx.fillRect(noteX - 1, barTop, w + 2, 2);
      }

      noteX += w;
    });

    // ── Tab notes ────────────────────────────────────────────────
    noteX = staffX + TL.lead;
    sys.indices.forEach(ci => {
      const col    = state.columns[ci];
      const w      = cw[ci];
      const noteCx = noteX + w / 2;
      const isCur  = ci === state.currentCol;

      for (let s = 0; s < 6; s++) {
        const fret = col[s];
        if (fret === undefined) continue;

        const ny   = tabTop + s * TL.lineH;
        const text = String(fret);

        cx.font     = `13px system-ui, 'Helvetica Neue', Arial, sans-serif`;
        const tw    = cx.measureText(text).width;
        const bgW   = tw + 8;
        const bgH   = TL.lineH - 2;

        cx.fillStyle = PAPER;
        cx.fillRect(noteCx - bgW / 2, ny - bgH / 2, bgW, bgH);

        cx.font         = isCur
          ? `bold 13px system-ui, 'Helvetica Neue', Arial, sans-serif`
          : `13px system-ui, 'Helvetica Neue', Arial, sans-serif`;
        cx.fillStyle    = isCur ? CUR_INK : INK;
        cx.textAlign    = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(text, noteCx, ny);
      }

      noteX += w;
    });

    // Build column centre-X map for this system (used by picking + arcs)
    const colCx = {};
    noteX = staffX + TL.lead;
    sys.indices.forEach(ci => {
      colCx[ci] = noteX + cw[ci] / 2;
      noteX += cw[ci];
    });

    // ── Bar lines ─────────────────────────────────────────────────
    sys.indices.forEach(ci => {
      if (!state.columns[ci]._barline) return;
      const bx = Math.round(colCx[ci]) + 0.5;
      cx.strokeStyle = INK;
      cx.lineWidth   = 1;
      cx.beginPath();
      cx.moveTo(bx, musicTop);
      cx.lineTo(bx, tabTop + tabStaffH);
      cx.stroke();
    });

    // ── Picking symbols ───────────────────────────────────────────
    sys.indices.forEach(ci => {
      const col   = state.columns[ci];
      const isCur = ci === state.currentCol;
      const pickY = tabTop - 22;
      const ink   = isCur ? CUR_INK : INK;
      const pick  = col._pick || autoPick[ci];
      if (pick === 'down') drawDownstroke(cx, colCx[ci], pickY, ink);
      if (pick === 'up')   drawUpstroke(cx, colCx[ci], pickY, ink);

      // Register hit target for all pickable columns (including 'none' state — invisible but clickable)
      const hasNote = Object.keys(col).some(k => !k.startsWith('_'));
      if (!col._barline && !col._break && !col._tech && !col._slide && hasNote) {
        pickHitTargets.push({ ci, x: colCx[ci], y: pickY, shown: pick || null });
      }
    });

    // ── Hammer-on / Pull-off arcs ─────────────────────────────────
    sys.indices.forEach(ci => {
      const col = state.columns[ci];
      if (!col._tech) return;

      // Find nearest previous non-break/non-barline column
      let prevCi = -1;
      for (let k = ci - 1; k >= 0; k--) {
        if (!state.columns[k]._break && !state.columns[k]._barline) { prevCi = k; break; }
      }
      if (prevCi < 0 || colCx[prevCi] === undefined) return;  // no prev or cross-system

      const prevCol = state.columns[prevCi];
      const x0      = colCx[prevCi];
      const x1      = colCx[ci];
      const isCur   = ci === state.currentCol;
      const ink     = isCur ? CUR_INK : INK;
      const label   = col._tech === 'hammer' ? 'H' : 'P';

      // Find topmost note in each column (lowest string index = top of tab staff)
      let srcString = -1, dstString = -1;
      for (let s = 0; s < 6; s++) {
        if (srcString < 0 && prevCol[s] !== undefined) srcString = s;
        if (dstString < 0 && col[s]     !== undefined) dstString = s;
        if (srcString >= 0 && dstString >= 0) break;
      }
      if (srcString < 0 || dstString < 0) return;

      const y0 = tabTop + srcString * TL.lineH - 8;
      const y1 = tabTop + dstString * TL.lineH - 8;
      drawTechArc(cx, x0, y0, x1, y1, label, ink);
    });

    // ── Slide lines ───────────────────────────────────────────────
    sys.indices.forEach(ci => {
      const col = state.columns[ci];
      if (!col._slide) return;

      // Find nearest previous non-break/non-barline column
      let prevCi = -1;
      for (let k = ci - 1; k >= 0; k--) {
        if (!state.columns[k]._break && !state.columns[k]._barline) { prevCi = k; break; }
      }
      if (prevCi < 0 || colCx[prevCi] === undefined) return;

      const prevCol = state.columns[prevCi];

      // Topmost note in each column
      let srcString = -1, dstString = -1;
      for (let s = 0; s < 6; s++) {
        if (srcString < 0 && prevCol[s] !== undefined) srcString = s;
        if (dstString < 0 && col[s]     !== undefined) dstString = s;
        if (srcString >= 0 && dstString >= 0) break;
      }
      if (srcString < 0 || dstString < 0) return;

      const isCur = ci === state.currentCol;
      const ink   = isCur ? CUR_INK : INK;
      const x0    = colCx[prevCi];
      const x1    = colCx[ci];
      const y0    = tabTop + srcString * TL.lineH;
      const y1    = tabTop + dstString * TL.lineH;

      // Edge offsets: half the column width minus a small gap
      const off0  = cw[prevCi] / 2 - 4;
      const off1  = cw[ci]     / 2 - 4;

      drawSlide(cx, x0, y0, x1, y1, off0, off1, ink);
    });

    // ── Bend arrows ───────────────────────────────────────────────
    sys.indices.forEach(ci => {
      const col = state.columns[ci];
      if (!col._bend) return;

      // Topmost note in the column
      let s = -1;
      for (let k = 0; k < 6; k++) { if (col[k] !== undefined) { s = k; break; } }
      if (s < 0) return;

      const isCur = ci === state.currentCol;
      const ink   = isCur ? CUR_INK : INK;
      drawBend(cx, colCx[ci], tabTop + s * TL.lineH, col._bend, ink);
    });

    // ── Vibrato squiggles ─────────────────────────────────────────
    sys.indices.forEach(ci => {
      const col = state.columns[ci];
      if (!col._vib) return;

      // Topmost note in the column
      let s = -1;
      for (let k = 0; k < 6; k++) { if (col[k] !== undefined) { s = k; break; } }
      if (s < 0) return;

      const isCur = ci === state.currentCol;
      const ink   = isCur ? CUR_INK : INK;
      drawVibrato(cx, colCx[ci], tabTop + s * TL.lineH - 13, ink);
    });

    // ── 8va spans ─────────────────────────────────────────────────
    const eightvaY = musicTop - 18;

    // Collect all column indices on this row that carry _8va
    const eightvaIndices = sys.indices.filter(ci => state.columns[ci]._8va);

    if (eightvaIndices.length > 0) {
      cx.font         = `italic bold 10px Georgia, serif`;
      cx.fillStyle    = INK;
      cx.textAlign    = 'left';
      cx.textBaseline = 'bottom';
      const labelW = cx.measureText('8va').width + 3;

      const ciFirst = eightvaIndices[0];
      const ciLast  = eightvaIndices[eightvaIndices.length - 1];
      const x0      = colCx[ciFirst] - cw[ciFirst] / 2;
      const x1      = colCx[ciLast]  + cw[ciLast]  / 2;

      // Does 8va start on this row (no _8va column before this row)?
      const isRowStart = !sys.indices.some(ci => ci < ciFirst && state.columns[ci - 1]?._8va) &&
        (ciFirst === 0 || !state.columns[ciFirst - 1]._8va);

      let lineStartX = x0;
      if (isRowStart) {
        cx.fillText('8va', x0, eightvaY + 1);
        lineStartX = x0 + labelW;
      }

      // One continuous dashed line from start to end across the whole row
      cx.strokeStyle = INK;
      cx.lineWidth   = 0.9;
      cx.setLineDash([4, 3]);
      cx.beginPath();
      cx.moveTo(lineStartX, eightvaY - 3);
      cx.lineTo(x1,         eightvaY - 3);
      cx.stroke();
      cx.setLineDash([]);

      // Terminal hook only if 8va ends on this row
      const nextGlobalIdx = ciLast + 1;
      const isEnd = nextGlobalIdx >= state.columns.length || !state.columns[nextGlobalIdx]._8va;
      if (isEnd) {
        cx.beginPath();
        cx.moveTo(x1, eightvaY - 3);
        cx.lineTo(x1, eightvaY + 5);
        cx.stroke();
      }
    }
    cx.setLineDash([]);

    // ── Music notes ───────────────────────────────────────────────
    renderMusicNotes(cx, sys, staffX, musicTop, musicStaffH, cw);

    // ── System-continuation label ─────────────────────────────────
    if (si > 0) {
      cx.font         = `11px system-ui, sans-serif`;
      cx.fillStyle    = INK_DIM;
      cx.textAlign    = 'right';
      cx.textBaseline = 'top';
      cx.fillText(`col ${sys.start + 1}–`, staffX + staffW, tabTop + tabStaffH + 5);
    }
  });
}

// ── Treble clef drawn with canvas paths ──────────────────────────────────────
//
// Coordinate system: 1 unit = lineH.  Y axis: 0 = top staff line (F5),
// 4 = bottom staff line (E4).  Clef spans roughly y ∈ [−1.5, 5.2].
//
function drawTrebleClef(cx, left, staffTop, staffH) {
  const lineH = staffH / 4;

  cx.save();
  cx.translate(left + lineH * 0.18, staffTop);
  cx.scale(lineH, lineH);

  cx.strokeStyle = INK;
  cx.lineCap     = 'round';
  cx.lineJoin    = 'round';

  // ── Main stroke: from top curl sweeping down to lower tail ──────
  cx.lineWidth = 0.155;
  cx.beginPath();
  // Upper curl (above staff)
  cx.moveTo(0.55, -1.3);
  cx.bezierCurveTo(1.35, -1.0,  1.45,  0.3,  0.7,  0.9);
  // Curve through staff body down to bottom area
  cx.bezierCurveTo(-0.1,  1.5, -0.5,  2.4, -0.55,  3.1);
  cx.bezierCurveTo(-0.55,  3.9, -0.1,  4.4,  0.55,  4.65);
  // Lower tail with bottom curl
  cx.bezierCurveTo( 1.3,  4.9,  1.35,  5.6,  0.55,  5.55);
  cx.bezierCurveTo(-0.3,  5.5, -0.55,  4.7,  0.0,   4.3);
  cx.stroke();

  // ── G-loop: circle centred on the G line (y = 3, 2nd from bottom) ──
  cx.lineWidth = 0.13;
  cx.beginPath();
  cx.arc(0.55, 3.05, 0.82, 0, Math.PI * 2);
  cx.stroke();

  // ── Mask the interior of the loop so the staff line is hidden ──────
  cx.fillStyle = PAPER;
  cx.beginPath();
  cx.arc(0.55, 3.05, 0.62, 0, Math.PI * 2);
  cx.fill();

  cx.restore();
}

// ─── UI Updates ───────────────────────────────────────────────────────────────

function syncDurationUI() {
  const dur = state.columns[state.currentCol]._dur || 'quarter';
  document.getElementById('dur-quarter').classList.toggle('active', dur === 'quarter');
  document.getElementById('dur-8th').classList.toggle('active',     dur === 'eighth');
  document.getElementById('dur-16th').classList.toggle('active',    dur === 'sixteenth');
}

function syncSlideUI() {
  document.getElementById('btn-slide').classList.toggle('slide-active', state.slideMode);
}

function syncVibUI() {
  document.getElementById('btn-vib').classList.toggle('vib-active', state.vibMode);
}

function syncEightvaUI() {
  document.getElementById('btn-8va').classList.toggle('eightva-active', state.eightvaMode);
}

function syncTripletUI() {
  document.getElementById('btn-triplet').classList.toggle('triplet-active', state.tripletMode);
}

function syncBendUI() {
  const btn = document.getElementById('btn-bend');
  btn.classList.toggle('bend-half', state.bendMode === '1/2');
  btn.classList.toggle('bend-full', state.bendMode === 'full');
  btn.textContent =
    state.bendMode === '1/2'  ? 'Bend 1/2' :
    state.bendMode === 'full' ? 'Bend full' : 'Bend';
}

function syncTechUI() {
  const btn = document.getElementById('btn-tech');
  btn.classList.toggle('tech-hammer', state.techMode === 'hammer');
  btn.classList.toggle('tech-pull',   state.techMode === 'pull');
  btn.textContent =
    state.techMode === 'hammer' ? 'H (on)' :
    state.techMode === 'pull'   ? 'P (on)' : 'H / P';
}

function refresh() {
  draw();
  renderTab();
  syncDurationUI();
  syncTechUI();
  syncSlideUI();
  syncBendUI();
  syncVibUI();
  syncEightvaUI();
  syncTripletUI();

  document.getElementById('col-num').textContent   = state.currentCol + 1;
  document.getElementById('col-total').textContent = state.columns.length;

  const atFirst = state.currentCol === 0;
  const atLast  = state.currentCol === state.columns.length - 1;
  document.getElementById('btn-prev').disabled = atFirst;
  document.getElementById('btn-next').disabled = atLast;
}

// ─── Column Operations ────────────────────────────────────────────────────────

function goPrev() {
  let prev = state.currentCol - 1;
  while (prev >= 0 && (state.columns[prev]._break || state.columns[prev]._barline)) prev--;
  if (prev >= 0) { state.currentCol = prev; refresh(); }
}

function goNext() {
  let next = state.currentCol + 1;
  while (next < state.columns.length && (state.columns[next]._break || state.columns[next]._barline)) next++;
  if (next < state.columns.length) { state.currentCol = next; refresh(); }
}

function addColumn() {
  state.columns.splice(state.currentCol + 1, 0, { _dur: state.selectedDur });
  state.currentCol++;
  refresh();
}

function addRest() {
  state.columns.splice(state.currentCol + 1, 0, { _dur: state.selectedDur, _rest: true });
  state.currentCol++;
  refresh();
}

function toggleVib() {
  state.vibMode = !state.vibMode;
  refresh();
}

function toggleEightva() {
  state.eightvaMode = !state.eightvaMode;
  refresh();
}

function toggleTriplet() {
  state.tripletMode = !state.tripletMode;
  refresh();
}

function cycleBend() {
  const modes   = [null, '1/2', 'full'];
  const nextIdx = (modes.indexOf(state.bendMode) + 1) % modes.length;
  state.bendMode = modes[nextIdx];
  refresh();
}

function toggleSlide() {
  state.slideMode = !state.slideMode;
  refresh();
}

function cycleTech() {
  const modes   = [null, 'hammer', 'pull'];
  const nextIdx = (modes.indexOf(state.techMode) + 1) % modes.length;
  state.techMode = modes[nextIdx];
  refresh();
}

function addPick() {
  const col = state.columns[state.currentCol];
  if (col._pick) {
    delete col._pick;  // toggle off if already set
  } else {
    const next = state.lastPick === 'down' ? 'up' : 'down';
    col._pick       = next;
    state.lastPick  = next;
  }
  refresh();
}

function addBarline() {
  state.columns.splice(state.currentCol + 1, 0,
    { _barline: true },
    { _dur: state.selectedDur }
  );
  state.currentCol += 2;
  refresh();
}

function addGroupBreak() {
  // Insert invisible break marker then a fresh column; land on the fresh column
  state.columns.splice(state.currentCol + 1, 0,
    { _break: true },
    { _dur: state.selectedDur }
  );
  state.currentCol += 2;
  refresh();
}

function deleteColumn() {
  if (state.columns.length === 1) {
    state.columns[0] = {};
  } else {
    state.columns.splice(state.currentCol, 1);
    if (state.currentCol >= state.columns.length) state.currentCol--;
  }
  refresh();
}

function clearColumn() {
  state.columns[state.currentCol] = {};
  refresh();
}

function clearAll() {
  if (!confirm('Clear the entire tab?')) return;
  state.columns    = [{ _dur: state.selectedDur }];
  state.currentCol = 0;
  refresh();
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

canvas.addEventListener('click', e => {
  const hit = hitTest(...Object.values(canvasPos(e)));
  if (!hit) return;

  const col = state.columns[state.currentCol];
  delete col._rest;           // clicking a rest column converts it to a note column
  if (col[hit.string] === hit.fret) {
    delete col[hit.string];   // toggle off
  } else {
    col[hit.string] = hit.fret;
    if (state.techMode)  col._tech  = state.techMode;
    if (state.slideMode) col._slide = true;
    if (state.bendMode)  col._bend  = state.bendMode;
    if (state.vibMode)    col._vib    = true;
    if (state.eightvaMode)  col._8va     = true;
    if (state.tripletMode)  col._triplet = true;
  }
  refresh();
});

canvas.addEventListener('mousemove', e => {
  const hit = hitTest(...Object.values(canvasPos(e)));
  state.hover = hit;
  canvas.style.cursor = hit ? 'pointer' : 'default';
  draw(); // lightweight — skip full refresh
});

canvas.addEventListener('mouseleave', () => {
  state.hover = null;
  canvas.style.cursor = 'default';
  draw();
});

document.getElementById('btn-prev').addEventListener('click', goPrev);
document.getElementById('btn-next').addEventListener('click', goNext);
document.getElementById('btn-add').addEventListener('click', addColumn);
document.getElementById('btn-add-rest').addEventListener('click', addRest);
document.getElementById('btn-end-set').addEventListener('click', addGroupBreak);
document.getElementById('btn-barline').addEventListener('click', addBarline);
document.getElementById('btn-pick').addEventListener('click', addPick);
document.getElementById('btn-tech').addEventListener('click', cycleTech);
document.getElementById('btn-slide').addEventListener('click', toggleSlide);
document.getElementById('btn-bend').addEventListener('click', cycleBend);
document.getElementById('btn-vib').addEventListener('click', toggleVib);
document.getElementById('btn-8va').addEventListener('click', toggleEightva);
document.getElementById('btn-triplet').addEventListener('click', toggleTriplet);
document.getElementById('btn-del').addEventListener('click', deleteColumn);
document.getElementById('btn-clear-col').addEventListener('click', clearColumn);
document.getElementById('btn-clear-all').addEventListener('click', clearAll);

document.getElementById('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(tabText());
    const btn = document.getElementById('btn-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => (btn.textContent = orig), 2000);
  } catch {
    /* clipboard not available */
  }
});

document.addEventListener('keydown', e => {
  // Don't interfere with inputs
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); goPrev();       break;
    case 'ArrowRight': e.preventDefault(); goNext();       break;
    case 'Enter':      e.preventDefault(); addColumn();    break;
    case 'Backspace':  e.preventDefault(); clearColumn();  break;
    case ' ':          e.preventDefault(); isPlaying ? stopPlayback() : startPlayback(); break;
  }
});

// ─── Audio Playback ───────────────────────────────────────────────────────────

let audioCtx      = null;
let playSchedule  = [];   // [{ ci, t }] — scheduled column start times
let playStartTime = 0;
let playAnimFrame = null;
let isPlaying     = false;
let priorCol      = 0;    // restore currentCol when playback ends

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Duration of one column in seconds given the current BPM. */
function colDurSec(col, beatSec) {
  const dur  = col._dur || 'quarter';
  const base = dur === 'quarter' ? beatSec : dur === 'eighth' ? beatSec / 2 : beatSec / 4;
  return col._triplet ? base * 2 / 3 : base;
}

/**
 * Schedule a Karplus-Strong plucked-string note.
 * Sounds convincingly guitar-like without any samples.
 */
function ksNote(freq, durSec, ctx, compressor, when) {
  const sr  = ctx.sampleRate;
  const N   = Math.max(2, Math.round(sr / freq));
  const len = Math.ceil(sr * Math.max(durSec * 2.5, 2.0));
  const buf = ctx.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // Seed buffer with white noise
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random() * 2 - 1;

  // Karplus-Strong: average adjacent samples → lowpass + feedback = pluck decay
  for (let i = 0; i < len; i++) {
    const j = i % N;
    const k = (i + 1) % N;
    d[i]     = seed[j];
    seed[j]  = 0.4975 * (seed[j] + seed[k]); // slightly < 0.5 for natural decay
  }

  const src  = ctx.createBufferSource();
  src.buffer = buf;

  const gain = ctx.createGain();
  const env  = Math.max(durSec * 2.5, 2.0);
  gain.gain.setValueAtTime(0.65, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + env);

  src.connect(gain);
  gain.connect(compressor);
  src.start(when);
  src.stop(when + env + 0.05);
}

function startPlayback() {
  stopPlayback();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Compressor prevents clipping when chords play simultaneously
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value      = 6;
  comp.ratio.value     = 4;
  comp.attack.value    = 0.003;
  comp.release.value   = 0.15;
  comp.connect(audioCtx.destination);

  const bpmEl   = document.getElementById('bpm');
  const bpm     = Math.max(20, Math.min(300, parseInt(bpmEl.value) || 120));
  const beatSec = 60 / bpm;

  priorCol     = state.currentCol;
  playSchedule = [];
  let t        = audioCtx.currentTime + 0.08;

  state.columns.forEach((col, ci) => {
    if (col._break || col._barline) return;     // no time, no sound
    const dur = colDurSec(col, beatSec);

    if (!col._rest) {
      playSchedule.push({ ci, t });
      for (let s = 0; s < 6; s++) {
        if (col[s] === undefined) continue;
        const bendOff = col._bend === 'full' ? 2 : col._bend === '1/2' ? 1 : 0;
        const midi    = OPEN_MIDI[s] + col[s] + bendOff + (col._8va ? 12 : 0);
        ksNote(midiToFreq(midi), dur, audioCtx, comp, t);
      }
    }

    t += dur;
  });

  playStartTime = audioCtx.currentTime + 0.08;
  isPlaying     = true;
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-stop').disabled = false;
  animatePlayback();
}

function animatePlayback() {
  const elapsed = audioCtx.currentTime - playStartTime;

  // Find the column currently playing
  let activeCi = -1;
  for (let i = playSchedule.length - 1; i >= 0; i--) {
    if (playSchedule[i].t - playStartTime <= elapsed + 0.02) {
      activeCi = playSchedule[i].ci;
      break;
    }
  }

  if (activeCi !== -1 && activeCi !== state.currentCol) {
    state.currentCol = activeCi;
    refresh();
  }

  // Stop when all notes have passed
  const lastT = playSchedule.length > 0 ? playSchedule[playSchedule.length - 1].t : playStartTime;
  if (audioCtx.currentTime > lastT + 2.5) {
    stopPlayback();
    return;
  }

  playAnimFrame = requestAnimationFrame(animatePlayback);
}

function stopPlayback() {
  if (playAnimFrame) { cancelAnimationFrame(playAnimFrame); playAnimFrame = null; }
  if (audioCtx)     { audioCtx.close(); audioCtx = null; }
  isPlaying    = false;
  playSchedule = [];
  document.getElementById('btn-play').disabled = false;
  document.getElementById('btn-stop').disabled = true;
  state.currentCol = priorCol;
  refresh();
}

document.getElementById('btn-play').addEventListener('click', startPlayback);
document.getElementById('btn-stop').addEventListener('click', stopPlayback);

// ─── Duration selector ────────────────────────────────────────────────────────

[['dur-quarter', 'quarter'], ['dur-8th', 'eighth'], ['dur-16th', 'sixteenth']].forEach(([id, dur]) => {
  document.getElementById(id).addEventListener('click', () => {
    state.selectedDur = dur;
    state.columns[state.currentCol]._dur = dur;
    refresh();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

initLayout();
refresh();

// Re-render tab if the container is resized (e.g. window resize)
new ResizeObserver(() => renderTab())
  .observe(document.getElementById('tab-canvas').parentElement);

// ── Tab canvas pick-symbol click cycling ──────────────────────────────────────
// Cycle: down → up → none → down → …
document.getElementById('tab-canvas').addEventListener('click', e => {
  const tc   = document.getElementById('tab-canvas');
  const rect = tc.getBoundingClientRect();
  const lx   = e.clientX - rect.left;
  const ly   = e.clientY - rect.top;

  for (const t of pickHitTargets) {
    if (Math.abs(lx - t.x) <= 14 && Math.abs(ly - t.y) <= 14) {
      const col = state.columns[t.ci];
      if      (t.shown === 'down') col._pick = 'up';
      else if (t.shown === 'up')   col._pick = 'none';
      else                          col._pick = 'down'; // shown === null or 'none'
      refresh();
      return;
    }
  }
});
