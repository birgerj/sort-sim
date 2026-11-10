// Generated textures, shared by all scene modules. Each is drawn once on a
// canvas and cached. They are mostly light and neutral, so a material's own
// colour (day or night) still decides the look: detail comes from print,
// seams and wear, in the flat illustration style of the day palette.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

export function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** Fill with grey noise around `base` (0–255). */
function grain(g: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number, tint: [number, number, number] = [1, 1, 1]): void {
  const id = g.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = base + (Math.random() - 0.5) * amp;
    id.data[i] = n * tint[0];
    id.data[i + 1] = n * tint[1];
    id.data[i + 2] = n * tint[2];
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

/** Corrugated cardboard side: flutes, brown tape across the middle, a print of arrows and a handle hole. */
export function cardboardSide(): THREE.CanvasTexture {
  return canvasTexture('cardboard-side', 256, 256, (g) => {
    grain(g, 256, 256, 235, 18);
    g.fillStyle = 'rgba(120,80,30,0.06)';
    for (let x = 0; x < 256; x += 6) g.fillRect(x, 0, 2, 256);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 112, 256, 30);
    g.strokeStyle = 'rgba(80,50,20,0.35)';
    g.lineWidth = 2;
    g.strokeRect(0, 112, 256, 30);
    // "This side up" arrows and a fragile glass, generic print.
    g.strokeStyle = 'rgba(40,30,20,0.55)';
    g.lineWidth = 5;
    for (const x of [36, 64]) {
      g.beginPath();
      g.moveTo(x, 80);
      g.lineTo(x, 44);
      g.moveTo(x - 10, 56);
      g.lineTo(x, 44);
      g.lineTo(x + 10, 56);
      g.stroke();
    }
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(190, 44);
    g.lineTo(220, 44);
    g.lineTo(212, 70);
    g.lineTo(198, 70);
    g.closePath();
    g.moveTo(205, 70);
    g.lineTo(205, 84);
    g.moveTo(194, 86);
    g.lineTo(216, 86);
    g.stroke();
    // Handle hole.
    g.fillStyle = 'rgba(30,20,10,0.65)';
    g.beginPath();
    g.ellipse(128, 196, 30, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(60,40,20,0.4)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 252, 252);
  });
}

/** Pallet wood: planks with grain and nail heads. */
export function palletWood(): THREE.CanvasTexture {
  return canvasTexture('pallet-wood', 128, 128, (g) => {
    grain(g, 128, 128, 225, 20, [1, 0.9, 0.75]);
    g.strokeStyle = 'rgba(110,70,30,0.25)';
    g.lineWidth = 1;
    for (let y = 0; y < 128; y += 4) {
      g.beginPath();
      g.moveTo(0, y + Math.random() * 2);
      g.bezierCurveTo(40, y + 3, 80, y - 3, 128, y + Math.random() * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(60,40,20,0.5)';
    for (let x = 0; x < 128; x += 42) g.fillRect(x, 0, 2, 128);
    g.fillStyle = 'rgba(70,70,70,0.8)';
    for (const [x, y] of [[10, 20], [10, 108], [118, 20], [118, 108]]) g.fillRect(x!, y!, 4, 4);
  });
}

/** Wire mesh for roll cages: thin bars on transparent, use with alphaTest. */
export function wireMesh(): THREE.CanvasTexture {
  return canvasTexture('wire-mesh', 128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    for (let k = 0; k <= 128; k += 16) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 128);
      g.moveTo(0, k);
      g.lineTo(128, k);
      g.stroke();
    }
  });
}

/** Sectional dock door: horizontal panels with a row of windows. */
export function sectionalDoor(): THREE.CanvasTexture {
  return canvasTexture('sectional-door', 128, 256, (g) => {
    g.fillStyle = '#f2f4f6';
    g.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, y, 128, 3);
      g.fillStyle = 'rgba(0,0,0,0.04)';
      for (let x = 0; x < 128; x += 8) g.fillRect(x, y + 6, 1, 22);
    }
    g.fillStyle = '#5a6b80';
    for (let x = 10; x < 120; x += 28) g.fillRect(x, 70, 20, 18);
    g.fillStyle = '#e8c000';
    g.fillRect(0, 244, 128, 12);
  });
}

/** Checker plate for dock levelers and platforms. */
export function checkerPlate(): THREE.CanvasTexture {
  return canvasTexture('checker-plate', 128, 128, (g) => {
    grain(g, 128, 128, 205, 16);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let y = 0; y < 128; y += 16) {
      for (let x = 0; x < 128; x += 16) {
        g.save();
        g.translate(x + 8 + ((y / 16) % 2) * 8, y + 8);
        g.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
        g.fillRect(-5, -1.5, 10, 3);
        g.restore();
      }
    }
  });
}

/** High-visibility vest: two reflective bands. */
export function hiVis(): THREE.CanvasTexture {
  return canvasTexture('hi-vis', 64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c9ced6';
    g.fillRect(0, 22, 64, 7);
    g.fillRect(0, 40, 64, 7);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(30, 0, 4, 64);
  });
}

/** Day floor: light, slightly mottled concrete with saw-cut joints every slab. */
export function dayFloor(): THREE.CanvasTexture {
  return canvasTexture('day-floor', 256, 256, (g) => {
    grain(g, 256, 256, 246, 8);
    for (let k = 0; k < 30; k++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(120,130,140,0.035)' : 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 50, 0, 7);
      g.fill();
    }
    g.strokeStyle = '#d5dae0';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
  });
}

/** Day wall cladding: vertical ribs, with a band of high windows near the top (v = 1). */
export function dayWall(): THREE.CanvasTexture {
  return canvasTexture('day-wall', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(x, 0, 3, 256);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(x + 3, 0, 2, 256);
    }
    g.fillStyle = '#cfe3f3';
    g.fillRect(0, 14, 256, 30);
    g.fillStyle = '#b8c4cf';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 14, 4, 30);
    g.fillRect(0, 12, 256, 3);
    g.fillRect(0, 44, 256, 3);
    // Kick plate.
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, 236, 256, 20);
  });
}

/** Brushed steel, for chutes, slides and frames by day. */
export function brushed(): THREE.CanvasTexture {
  return canvasTexture('brushed', 64, 256, (g) => {
    grain(g, 64, 256, 235, 10);
    g.globalAlpha = 0.2;
    for (let k = 0; k < 200; k++) {
      g.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#a0a8b0';
      g.fillRect(Math.random() * 64, 0, 1, 256);
    }
    g.globalAlpha = 1;
  });
}

/** Robot body side: a fleet number band, vents and a status light. */
export function robotSide(n: number): THREE.CanvasTexture {
  return canvasTexture(`robot-${n}`, 128, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#1d1d1f';
    g.font = '700 30px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(String(n), 10, 34);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 5; k++) g.fillRect(84 + k * 7, 18, 3, 28);
    g.fillStyle = '#f2c200';
    g.beginPath();
    g.moveTo(70, 18);
    g.lineTo(80, 36);
    g.lineTo(60, 36);
    g.closePath();
    g.fill();
  });
}

/**
 * A tangent-space normal map from a height function h(x, y) (0…1, in pixels of a w × h
 * tile that repeats). Only the realistic day turns these on (normalScale), so the drawn
 * look stays flat.
 */
export function normalFromHeight(key: string, w: number, h: number, height: (x: number, y: number) => number, strength: number): THREE.CanvasTexture {
  return canvasTexture(
    key,
    w,
    h,
    (g) => {
      const hs = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hs[y * w + x] = height(x, y);
      const at = (x: number, y: number) => hs[((y + h) % h) * w + ((x + w) % w)]!;
      const id = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
          // Canvas y runs down, texture v runs up.
          const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
          const l = Math.hypot(dx, dy, 1);
          const i = (y * w + x) * 4;
          id.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
          id.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
          id.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
          id.data[i + 3] = 255;
        }
      }
      g.putImageData(id, 0, 0);
    },
    false,
  );
}

/** Raised lozenges of the checker plate (matches `checkerPlate`). */
export function checkerPlateNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'checker-plate-n',
    128,
    128,
    (x, y) => {
      const row = Math.floor(y / 16);
      const cx = Math.floor((x - ((row % 2) * 8)) / 16) * 16 + 8 + (row % 2) * 8;
      const cy = row * 16 + 8;
      const a = (row % 2 ? 1 : -1) * 0.7;
      const px = x - cx;
      const py = y - cy;
      const u = px * Math.cos(a) + py * Math.sin(a);
      const v = -px * Math.sin(a) + py * Math.cos(a);
      // A rounded bar 10 × 3 px.
      const d = Math.max(Math.abs(u) / 5, Math.abs(v) / 1.5);
      return d < 1 ? 1 - d * d * d : 0;
    },
    2.2,
  );
}

/** Ribs of the wall cladding (matches `dayWall`: a rib every 16 px, flat at the window band). */
export function claddingNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'day-wall-n',
    256,
    256,
    (x, y) => {
      if (y >= 10 && y <= 48) return 0.5;
      const p = (x % 16) / 16;
      // Trapezoid rib: up, flat top, down, flat pan.
      return p < 0.15 ? p / 0.15 : p < 0.45 ? 1 : p < 0.6 ? 1 - (p - 0.45) / 0.15 : 0;
    },
    1.6,
  );
}

/** Panel joints and fine ribs of the sectional door (matches `sectionalDoor`). */
export function sectionalDoorNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'sectional-door-n',
    128,
    256,
    (x, y) => {
      const py = y % 32;
      // Groove at each panel joint, a slight bulge across each panel, fine vertical ribs.
      if (py < 3) return 0;
      const bulge = Math.sin((Math.PI * (py - 3)) / 29) * 0.6;
      const rib = py > 6 && py < 28 && x % 8 === 0 ? 0.15 : 0;
      // The windows sit flush in a recessed frame.
      if (y >= 68 && y <= 90 && (x - 8) % 28 < 24) return (x - 8) % 28 < 2 || (x - 8) % 28 > 21 || y < 70 || y > 88 ? 0.2 : 0.35;
      return 0.4 + bulge + rib;
    },
    1.4,
  );
}

/** Gaps between the planks and raised grain of pallet wood (matches `palletWood`). */
export function palletWoodNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'pallet-wood-n',
    128,
    128,
    (x, y) => {
      if (x % 42 < 2) return 0;
      const grainLine = Math.sin(y * 1.6 + Math.sin(x * 0.05) * 2) * 0.12;
      const nail = [[10, 20], [10, 108], [118, 20], [118, 108]].some(([nx, ny]) => Math.abs(x - nx! - 2) < 2 && Math.abs(y - ny! - 2) < 2);
      return 0.7 + grainLine - (nail ? 0.25 : 0);
    },
    1.2,
  );
}

/** Flutes, tape edges and the handle hole of a carton side (matches `cardboardSide`). */
export function cardboardNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'cardboard-side-n',
    256,
    256,
    (x, y) => {
      // Handle hole: pressed in.
      const hx = (x - 128) / 30;
      const hy = (y - 196) / 9;
      if (hx * hx + hy * hy < 1) return 0;
      // Tape across the middle stands a little proud of the board; flutes show faintly.
      const tape = y >= 112 && y <= 142 ? 0.12 : 0;
      const flute = Math.sin((x * Math.PI) / 3) * 0.05;
      // Slightly soft, dented edges.
      const edge = Math.min(x, y, 255 - x, 255 - y) < 4 ? -0.15 : 0;
      return 0.6 + tape + flute + edge;
    },
    1.0,
  );
}

/**
 * Stretch film over stacked cartons, for the realistic day: the cartons show through
 * a milky, slightly blue film, with brighter bands where it is wound tighter.
 * One tile covers a 1.2 m wrap face (cartons of 0.4 × 0.3 m).
 */
export function stretchFilm(): THREE.CanvasTexture {
  return canvasTexture('stretch-film', 256, 256, (g) => {
    grain(g, 256, 256, 185, 12, [0.9, 0.76, 0.58]);
    // Carton seams and tape under the film.
    g.strokeStyle = 'rgba(90,70,45,0.45)';
    g.lineWidth = 2;
    for (let y = 0; y <= 256; y += 64) {
      const off = (y / 64) % 2 ? 42 : 0;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      for (let x = off; x <= 256; x += 85) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 64);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(160,130,90,0.35)';
    for (let y = 0; y < 256; y += 64) g.fillRect(0, y + 28, 256, 8);
    // The film: milky over everything, brighter where wound twice.
    g.fillStyle = 'rgba(225,232,240,0.22)';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 18 + Math.floor(Math.random() * 14)) {
      g.fillStyle = `rgba(245,248,252,${0.06 + Math.random() * 0.1})`;
      g.fillRect(0, y, 256, 6 + Math.random() * 10);
    }
  });
}

/** Wrinkles of the stretch film: fine horizontal folds with a few creases across. */
export function stretchFilmNormal(): THREE.CanvasTexture {
  const ph = Array.from({ length: 8 }, () => Math.random() * 6.28);
  return normalFromHeight(
    'stretch-film-n',
    256,
    256,
    (x, y) => {
      // (Tile-periodic in x: whole sine periods over 256 px.)
      const fold = Math.sin(y * 0.55 + Math.sin((x * 2 * Math.PI) / 256 + ph[0]!) * 1.5) * 0.08;
      const band = Math.sin(y * 0.11 + ph[1]!) * 0.1;
      const crease = Math.pow(Math.max(0, Math.sin((x * 6 * Math.PI) / 256 + ph[2]! + y * 0.02)), 24) * 0.12;
      // Seams of the cartons beneath press through.
      const seam = y % 64 < 2 ? -0.15 : 0;
      return 0.5 + fold + band + crease + seam;
    },
    2.0,
  );
}

/** Saw-cut joints of the concrete floor (matches the realistic floor tile: joints at 0 and the middle). */
export function floorJointNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'floor-joint-n',
    256,
    256,
    (x, y) => {
      const dx = Math.min(x % 128, 128 - (x % 128));
      const dy = Math.min(y % 128, 128 - (y % 128));
      const d = Math.min(dx, dy);
      return d < 1 ? 0 : d < 2 ? 0.6 : 1;
    },
    1.5,
  );
}

/** Trapezoid ribs of the steel roof deck, one per tile (seen from below). */
export function roofDeckNormal(): THREE.CanvasTexture {
  return normalFromHeight(
    'roof-deck-n',
    64,
    8,
    (x) => {
      const p = x / 64;
      return p < 0.15 ? p / 0.15 : p < 0.4 ? 1 : p < 0.55 ? 1 - (p - 0.4) / 0.15 : 0;
    },
    5,
  );
}
