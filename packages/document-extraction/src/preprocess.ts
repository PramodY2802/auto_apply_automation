import sharp from 'sharp';
import { run } from './tools';

export interface PreprocessOptions {
  /** Upscale so the longest side is at least this many px (OCR likes ~300dpi). */
  minLongSide?: number;
  maxLongSide?: number;
  denoise?: boolean;
  deskew?: boolean;
  orientation?: boolean;
  binarize?: boolean;
}

export interface PreprocessResult {
  image: Buffer;
  applied: string[];
  skewAngle: number;
  rotation: number;
}

/**
 * ImagePreprocessor — prepares scans/photos for OCR:
 * orientation correction (Tesseract OSD), grayscale, resize, contrast
 * normalisation, median denoise, projection-profile deskew, optional binarisation.
 * Page segmentation is delegated to Tesseract's layout analysis (PSM 1/3).
 */
export class ImagePreprocessor {
  async process(input: Buffer, opts: PreprocessOptions = {}): Promise<PreprocessResult> {
    const o = { minLongSide: 2200, maxLongSide: 4200, denoise: true, deskew: true, orientation: true, binarize: false, ...opts };
    const applied: string[] = [];

    // Honour EXIF orientation first, then normalise to 8-bit grayscale PNG.
    let img = await sharp(input, { failOn: 'none' }).rotate().grayscale().png().toBuffer();
    applied.push('exif-orientation', 'grayscale');

    let meta = await sharp(img).metadata();
    const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longSide && longSide < o.minLongSide) {
      const scale = o.minLongSide / longSide;
      img = await sharp(img).resize(Math.round((meta.width ?? 0) * scale), Math.round((meta.height ?? 0) * scale), { kernel: 'lanczos3' }).png().toBuffer();
      applied.push(`upscale-x${scale.toFixed(2)}`);
    } else if (longSide > o.maxLongSide) {
      img = await sharp(img).resize({ width: meta.width! >= meta.height! ? o.maxLongSide : undefined, height: meta.height! > meta.width! ? o.maxLongSide : undefined }).png().toBuffer();
      applied.push('downscale');
    }

    let rotation = 0;
    if (o.orientation) {
      rotation = await detectOrientation(img);
      if (rotation) {
        img = await sharp(img).rotate(rotation, { background: '#ffffff' }).png().toBuffer();
        applied.push(`rotate-${rotation}`);
      }
    }

    img = await sharp(img).normalise().png().toBuffer();
    applied.push('contrast-normalise');

    if (o.denoise) {
      img = await sharp(img).median(3).png().toBuffer();
      applied.push('median-denoise');
    }

    let skewAngle = 0;
    if (o.deskew) {
      skewAngle = await estimateSkew(img);
      if (Math.abs(skewAngle) >= 0.3) {
        // estimateSkew is positive for counter-clockwise content; sharp rotates clockwise for positive angles.
        img = await sharp(img).rotate(skewAngle, { background: '#ffffff' }).png().toBuffer();
        applied.push(`deskew-${skewAngle.toFixed(1)}deg`);
      }
    }

    if (o.binarize) {
      img = await sharp(img).threshold(160).png().toBuffer();
      applied.push('binarize');
    }
    meta = await sharp(img).metadata();
    return { image: img, applied, skewAngle, rotation };
  }
}

/**
 * Projection-profile skew estimation. Dark pixels of a downsampled copy are
 * projected onto the vertical axis for candidate angles; text lines align
 * (sharp histogram peaks) at the true skew. Returns degrees, positive = the
 * content is rotated counter-clockwise.
 */
export async function estimateSkew(img: Buffer, maxAngle = 10, step = 0.25): Promise<number> {
  const { data, info } = await sharp(img).resize({ width: 900, withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const xs: number[] = [];
  const ys: number[] = [];
  // Sample dark pixels (stride keeps it fast on large pages).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 2) {
      if (data[y * width + x]! < 110) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;
  const cx = width / 2;
  let best = 0;
  let bestScore = -Infinity;
  const bins = new Float64Array(height * 2 + 10);
  for (let a = -maxAngle; a <= maxAngle + 1e-9; a += step) {
    const rad = (a * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    bins.fill(0);
    for (let i = 0; i < xs.length; i++) {
      // Row index after rotating the point by -a around the centre column.
      const yy = Math.round(ys[i]! * cos + (xs[i]! - cx) * sin) + height;
      if (yy >= 0 && yy < bins.length) bins[yy]! += 1;
    }
    let score = 0;
    for (let i = 1; i < bins.length; i++) {
      const d = bins[i]! - bins[i - 1]!;
      score += d * d;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return Math.round(best * 100) / 100;
}

/** Tesseract OSD → clockwise rotation (0/90/180/270) needed to make text upright. */
export async function detectOrientation(img: Buffer): Promise<number> {
  try {
    const small = await sharp(img).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const { stdout } = await run('tesseract', ['stdin', 'stdout', '--psm', '0', '-l', 'osd'], { input: small, timeoutMs: 60_000 });
    const out = stdout.toString('utf8');
    const rot = /Rotate:\s+(\d+)/.exec(out);
    const conf = /Orientation confidence:\s+([\d.]+)/.exec(out);
    if (rot && conf && Number(conf[1]) >= 1.5) return Number(rot[1]) % 360;
  } catch {
    // OSD fails on pages with too little text; treat as upright.
  }
  return 0;
}
