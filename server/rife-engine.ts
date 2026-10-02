import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { VideoMetadata, ExportSettings } from './types';

export interface RifeEngineInfo {
  isAvailable: boolean;
  binaryPath: string;
  modelsDir: string;
  defaultModel: string;
  availableModels: string[];
  vulkanDriver: string;
}

const RIFE_BINARY_PATH = '/usr/local/bin/rife-ncnn-vulkan';
const RIFE_MODELS_DIR = '/opt/rife/models';

/**
 * Inspects system for RIFE ncnn vulkan binary and installed neural network models.
 */
export function getRifeEngineInfo(): RifeEngineInfo {
  const binaryExists = fs.existsSync(RIFE_BINARY_PATH);
  const modelsDirExists = fs.existsSync(RIFE_MODELS_DIR);

  let availableModels: string[] = [];
  if (modelsDirExists) {
    try {
      availableModels = fs
        .readdirSync(RIFE_MODELS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('rife'))
        .map((d) => d.name);
    } catch {
      availableModels = [];
    }
  }

  const isAvailable = binaryExists && availableModels.length > 0;

  return {
    isAvailable,
    binaryPath: RIFE_BINARY_PATH,
    modelsDir: RIFE_MODELS_DIR,
    defaultModel: availableModels.includes('rife-v4') ? 'rife-v4' : availableModels[0] || 'rife-v2.3',
    availableModels,
    vulkanDriver: 'llvmpipe (Mesa CPU Rasterizer)',
  };
}

export interface RifeProcessOptions {
  model?: string;
  targetFps?: number;
  scaleDownForSpeed?: boolean;
}

export type RifeProgressCallback = (progress: {
  phase: string;
  phaseLabelAr: string;
  percent: number;
  logMessage?: string;
}) => void;

/**
 * Interpolates video frames to 60 FPS using the genuine RIFE AI Neural Network.
 */
export async function runRifeInterpolation(
  inputVideoPath: string,
  outputVideoPath: string,
  meta: VideoMetadata,
  settings: ExportSettings,
  onProgress?: RifeProgressCallback
): Promise<void> {
  const info = getRifeEngineInfo();
  if (!info.isAvailable) {
    throw new Error('محرك الذكاء الاصطناعي RIFE-NCNN-Vulkan غير مثبت على النظام.');
  }

  const workDir = path.join('/tmp', `rife_job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const framesInDir = path.join(workDir, 'frames_in');
  const framesOutDir = path.join(workDir, 'frames_out');
  const audioExtractPath = path.join(workDir, 'audio_track.aac');

  fs.mkdirSync(framesInDir, { recursive: true });
  fs.mkdirSync(framesOutDir, { recursive: true });

  const chosenModel = path.join(info.modelsDir, 'rife-v4');
  const modelToUse = fs.existsSync(chosenModel) ? chosenModel : path.join(info.modelsDir, info.defaultModel);

  try {
    // ----------------------------------------------------
    // STEP 1: Extract Audio (Lossless Copy)
    // ----------------------------------------------------
    onProgress?.({
      phase: 'preparing_frames',
      phaseLabelAr: 'استخراج المسار الصوتي الأصلي',
      percent: 10,
      logMessage: 'استخراج الصوت الأصلي بدون فقد في الجودة...',
    });

    let hasAudio = false;
    if (meta.audioCodec && meta.audioCodec !== 'none') {
      try {
        await new Promise<void>((resolve, reject) => {
          const p = spawn('ffmpeg', [
            '-y',
            '-i', inputVideoPath,
            '-vn',
            '-c:a', 'copy',
            audioExtractPath,
          ]);
          p.on('close', (code) => {
            if (code === 0 && fs.existsSync(audioExtractPath) && fs.statSync(audioExtractPath).size > 0) {
              hasAudio = true;
            }
            resolve();
          });
          p.on('error', () => resolve());
        });
      } catch {
        hasAudio = false;
      }
    }

    // ----------------------------------------------------
    // STEP 2: Extract Frames
    // ----------------------------------------------------
    onProgress?.({
      phase: 'preparing_frames',
      phaseLabelAr: 'استخراج وتجهيز إطارات الفيديو',
      percent: 20,
      logMessage: 'تقطيع الفيديو إلى إطارات بدقة عالية لتحليل الحركة العصبية...',
    });

    // Determine scale for RIFE processing to balance speed and neural fidelity
    const speed = settings.speedEngine || 'turbo';
    let extractScale = '';
    if (speed === 'turbo' && (meta.width > 720 || meta.height > 1280)) {
      extractScale = '-vf scale=720:1280:force_original_aspect_ratio=decrease';
    }

    const extractArgs = [
      '-y',
      '-i', inputVideoPath,
      ...(extractScale ? extractScale.split(' ') : []),
      '-q:v', '2',
      path.join(framesInDir, '%08d.png'),
    ];

    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', extractArgs);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`فشل استخراج الإطارات برمز ${code}`));
      });
      p.on('error', reject);
    });

    const totalExtractedFrames = fs.readdirSync(framesInDir).length;
    if (totalExtractedFrames === 0) {
      throw new Error('لم يتم استخراج أي إطارات من ملف الفيديو.');
    }

    // ----------------------------------------------------
    // STEP 3: Execute RIFE Neural AI Interpolation
    // ----------------------------------------------------
    onProgress?.({
      phase: 'enhancing_motion',
      phaseLabelAr: 'توليد إطارات حقيقية بنموذج الذكاء الاصطناعي (RIFE AI 60 FPS)',
      percent: 35,
      logMessage: `بدء المعالجة بالذكاء الاصطناعي عبر نموذج ${path.basename(modelToUse)} على ${totalExtractedFrames} إطار...`,
    });

    await new Promise<void>((resolve, reject) => {
      const rifeProc = spawn(
        info.binaryPath,
        [
          '-i', framesInDir,
          '-o', framesOutDir,
          '-m', modelToUse,
          '-j', '1:2:2',
        ],
        {
          env: {
            ...process.env,
            VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/lvp_icd.x86_64.json',
          },
        }
      );

      rifeProc.stderr.on('data', (data) => {
        const text = data.toString();
        // Look for percentage patterns like "45.00%"
        const match = text.match(/([0-9.]+)%/);
        if (match) {
          const rifePercent = parseFloat(match[1]);
          if (!isNaN(rifePercent)) {
            // Map 0-100% of RIFE to 35-80% of total job progress
            const mappedPercent = Math.round(35 + (rifePercent / 100) * 45);
            onProgress?.({
              phase: 'enhancing_motion',
              phaseLabelAr: 'توليد إطارات حقيقية بنموذج الذكاء الاصطناعي (RIFE AI 60 FPS)',
              percent: mappedPercent,
              logMessage: `معالجة الإطارات العصبية: ${rifePercent.toFixed(1)}% مكتمل`,
            });
          }
        }
      });

      rifeProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`فشل محرك RIFE AI برمز خطأ (${code})`));
      });

      rifeProc.on('error', reject);
    });

    // ----------------------------------------------------
    // STEP 4: Build Final Mastered Video with TikTok Specs
    // ----------------------------------------------------
    onProgress?.({
      phase: 'encoding_output',
      phaseLabelAr: 'ترميز وتجميع الفيديو النهائي لـ TikTok (60 FPS)',
      percent: 85,
      logMessage: 'دمج الإطارات المعالجة بالذكاء الاصطناعي وتطبيق معايرة TikTok النهائية...',
    });

    // Build mastering filters (scale to 1080x1920, pre-emphasis, color vibrant)
    const vfParts: string[] = [];
    if (settings.resolution === '1080x1920') {
      vfParts.push('scale=1080:1920:flags=bicubic');
    }

    if (settings.clarityEngine === 'tiktok_pre_emphasis' || settings.clarityEngine === 'pro_sharp') {
      vfParts.push('unsharp=5:5:0.8:3:3:0.4');
    } else {
      vfParts.push('unsharp=3:3:0.35:3:3:0.0');
    }

    if (settings.colorEngine === 'tiktok_vibrant') {
      vfParts.push('eq=contrast=1.04:brightness=0.01:saturation=1.08');
    }

    vfParts.push('format=yuv420p');

    const encodeArgs: string[] = [
      '-y',
      '-framerate', '60',
      '-i', path.join(framesOutDir, '%08d.png'),
    ];

    if (hasAudio) {
      encodeArgs.push('-i', audioExtractPath);
    }

    encodeArgs.push(
      '-vf', vfParts.join(','),
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.2',
      '-preset', speed === 'turbo' ? 'fast' : 'medium',
      '-crf', String(settings.crfValue || 19),
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-flags', '+cgop'
    );

    if (settings.compressionGuard) {
      encodeArgs.push('-aq-mode', '3');
    }

    if (hasAudio) {
      encodeArgs.push(
        '-c:a', 'aac',
        '-b:a', `${settings.audioBitrateKbps || 256}k`,
        '-ar', '48000',
        '-ac', '2'
      );
    }

    if (settings.fastStart) {
      encodeArgs.push('-movflags', '+faststart');
    }

    encodeArgs.push(outputVideoPath);

    await new Promise<void>((resolve, reject) => {
      const encProc = spawn('ffmpeg', encodeArgs);
      encProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`فشل ترميز الفيديو النهائي برمز (${code})`));
      });
      encProc.on('error', reject);
    });

    onProgress?.({
      phase: 'completed',
      phaseLabelAr: 'اكتملت المعالجة بنجاح عبر RIFE AI',
      percent: 100,
      logMessage: 'تمت مضاعفة الإطارات إلى 60 FPS حقيقية بالذكاء الاصطناعي وتجهيز الفيديو لـ TikTok',
    });
  } finally {
    // Clean up temporary workspace safely
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  }
}
