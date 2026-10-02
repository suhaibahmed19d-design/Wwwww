import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { VideoMetadata, ExportSettings } from './types';

const execAsync = promisify(exec);

export interface HardwareProfile {
  cpuModel: string;
  cores: number;
  hasNvidiaGpu: boolean;
  gpuName?: string;
  hasVaapi: boolean;
  recommendedThreads: number;
  aiEngineStatus: 'gpu_accelerated' | 'cpu_optimized' | 'lightweight_fallback';
}

// Inspect hardware environment
export async function detectHardwareProfile(): Promise<HardwareProfile> {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Standard CPU';
  const cores = cpus.length || 2;
  const recommendedThreads = Math.max(1, Math.min(cores, 8));

  let hasNvidiaGpu = false;
  let gpuName: string | undefined;
  let hasVaapi = false;

  // Check nvidia-smi explicitly
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 1500 });
    if (stdout.trim()) {
      hasNvidiaGpu = true;
      gpuName = stdout.trim().split('\n')[0];
    }
  } catch {
    hasNvidiaGpu = false;
  }

  const aiEngineStatus = hasNvidiaGpu
    ? 'gpu_accelerated'
    : cores >= 4
    ? 'cpu_optimized'
    : 'lightweight_fallback';

  return {
    cpuModel,
    cores,
    hasNvidiaGpu,
    gpuName,
    hasVaapi,
    recommendedThreads,
    aiEngineStatus,
  };
}

/**
 * Builds the modular FFmpeg command arguments based on Video Metadata, Export Settings, and Hardware Profile.
 */
export function buildFfmpegPipeline(
  inputPath: string,
  outputPath: string,
  meta: VideoMetadata,
  settings: ExportSettings,
  hw: HardwareProfile
): { args: string[]; pipelineDescriptionAr: string } {
  // Security protocol whitelist
  const args: string[] = ['-y', '-protocol_whitelist', 'file,crypto,data', '-i', inputPath];
  const pipelineSteps: string[] = [];

  // 0. Smart Passthrough Check:
  const isResolutionSatisfied =
    settings.resolution === 'original' ||
    (settings.resolution === '1080x1920' && meta.width === 1080 && meta.height === 1920);

  const isAlreadyOptimal =
    isResolutionSatisfied &&
    meta.fps >= 59 &&
    meta.fps <= 61 &&
    meta.videoCodec === 'h264' &&
    meta.pixelFormat === 'yuv420p';

  if (settings.allowSmartPassthrough && isAlreadyOptimal && settings.preset !== 'custom') {
    args.push('-c:v', 'copy');
    if (meta.audioCodec && meta.audioCodec !== 'none') {
      args.push('-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
    }
    if (settings.fastStart) args.push('-movflags', '+faststart');
    args.push(outputPath);
    return {
      args,
      pipelineDescriptionAr: 'التمرير السريع المباشر (Smart Direct Stream Copy) — الفيديو مهيأ مسبقاً بنسبة 100%',
    };
  }

  const speed = settings.speedEngine || 'turbo';
  const scaleFlag = speed === 'turbo' ? 'fast_bilinear' : 'bicubic';

  // 1. Motion & Frame Interpolation (Motion Flow / CFR 60)
  const isTargeting60 = settings.targetFps === 60;
  const needsInterpolation = isTargeting60 && meta.fps < 55 && settings.useAiInterpolation;

  const isLandscapeToVerticalBlur =
    settings.resolution === '1080x1920' &&
    !meta.isVertical &&
    settings.smartFit === 'cover_blur';

  if (isLandscapeToVerticalBlur) {
    let preFilter = '';
    if (needsInterpolation) {
      if (settings.interpolationEngine === 'cinema_blend') {
        preFilter = 'tblend=all_mode=average,framerate=fps=60,';
        pipelineSteps.push('مزج حركي سينمائي لـ 60 FPS');
      } else {
        preFilter = 'framerate=fps=60,';
        pipelineSteps.push('مضاعفة الإطارات الذكية لـ 60 FPS');
      }
    } else if (settings.targetFps !== 'original') {
      preFilter = `fps=${settings.targetFps},`;
      pipelineSteps.push(`تثبيت معدل الإطارات عند ${settings.targetFps} FPS`);
    }

    const unsharpPart = speed !== 'turbo' ? ',unsharp=3:3:0.35:3:3:0.0' : '';

    const filterComplex =
      `[0:v]${preFilter}split=2[orig][bg_in];` +
      `[bg_in]scale=1080:1920:force_original_aspect_ratio=increase:flags=${scaleFlag},crop=1080:1920,boxblur=14:2[bg];` +
      `[orig]scale=1080:1920:force_original_aspect_ratio=decrease:flags=${scaleFlag}[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2${unsharpPart},format=yuv420p[v_out]`;

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[v_out]');
    pipelineSteps.push('تحويل إلى عمودي 9:16 مع خلفية ضبابية متوازنة');
  } else {
    // Clean Linear Filter Chain (-vf)
    const vfFilters: string[] = [];

    // 1. Motion & Frame Interpolation Engine
    const interpEngine = settings.interpolationEngine || (settings.interpolationMode === 'blend' ? 'cinema_blend' : 'optical_flow_mci');
    if (needsInterpolation) {
      if (interpEngine === 'cinema_blend') {
        vfFilters.push('tblend=all_mode=average', 'framerate=fps=60');
        pipelineSteps.push('محرك Cinema Blend: مزج حركي سينمائي سلس بـ 60 FPS');
      } else if (interpEngine === 'optical_flow_mci' && speed === 'studio') {
        // High-end Motion Compensated Interpolation with AOBMC
        vfFilters.push('minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff');
        pipelineSteps.push('محرك التدفق البصري (Optical Flow MCI): توليد إطارات بينية حقيقية بالتعويض الحركي');
      } else {
        vfFilters.push('framerate=fps=60');
        pipelineSteps.push('محرك Motion Flow: مضاعفة الإطارات فائقة السرعة لـ 60 FPS');
      }
    } else if (settings.targetFps !== 'original') {
      vfFilters.push(`fps=${settings.targetFps}`);
      pipelineSteps.push(`تثبيت معدل الإطارات عند ${settings.targetFps} FPS`);
    }

    // 2. Resolution & Geometry Engine
    if (settings.resolution === 'original') {
      if (meta.width % 2 !== 0 || meta.height % 2 !== 0) {
        vfFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
      }
      pipelineSteps.push(`الحفاظ على المقاس الأصلي للفيديو (${meta.width}×${meta.height})`);
    } else if (settings.resolution === '1080x1920') {
      if (!meta.isVertical) {
        if (settings.smartFit === 'crop_center') {
          vfFilters.push(
            `scale=1080:1920:force_original_aspect_ratio=increase:flags=${scaleFlag}`,
            'crop=1080:1920'
          );
          pipelineSteps.push('اقتصاص مركزي ذكي لأبعاد 1080×1920');
        } else {
          vfFilters.push(
            `scale=1080:1920:force_original_aspect_ratio=decrease:flags=${scaleFlag}`,
            'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
          );
          pipelineSteps.push('ملاءمة الأبعاد لـ 1080×1920 مع حواف متوازنة');
        }
      } else if (meta.width !== 1080 || meta.height !== 1920) {
        vfFilters.push(`scale=1080:1920:flags=${scaleFlag}`);
        pipelineSteps.push(`إعادة تحجيم بدقة (${scaleFlag} 1080×1920)`);
      }
    } else if (settings.resolution === '720x1280') {
      vfFilters.push('scale=720:1280:flags=fast_bilinear');
      pipelineSteps.push('تحجيم اقتصادي سريع (720×1280)');
    }

    // 3. Color, Gamut & Dynamic Range Engine
    const colorEngine = settings.colorEngine || 'tiktok_vibrant';
    if (colorEngine === 'tiktok_vibrant') {
      vfFilters.push('eq=contrast=1.04:brightness=0.01:saturation=1.08');
      pipelineSteps.push('محرك حيوية الألوان (TikTok Vibrant): تعزيز النطاق الديناميكي والتشبع لشاشات الهواتف');
    } else if (colorEngine === 'cinema_warmth') {
      vfFilters.push('colorbalance=rs=0.02:bs=-0.02:rm=0.02:bm=-0.02', 'eq=contrast=1.03:saturation=1.04');
      pipelineSteps.push('محرك الدفء السينمائي (Cinematic Warmth): تدريج ألوان سينمائي جذاب');
    } else if (colorEngine === 'hdr_to_sdr') {
      vfFilters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', 'eq=contrast=1.02:saturation=1.03');
      pipelineSteps.push('محرك تحويل النطاق اللوني (HDR/Wide to BT.709 Legal Range)');
    } else if (colorEngine === 'natural_rec709') {
      vfFilters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
      pipelineSteps.push('محرك الألوان المعيارية الطبيعية (Rec.709 True Color)');
    }

    // 4. Clarity & Anti-Compression Guard Engine
    const clarity = settings.clarityEngine || (speed !== 'turbo' ? 'tiktok_pre_emphasis' : 'pro_sharp');
    if (clarity === 'tiktok_pre_emphasis') {
      vfFilters.push('unsharp=lx=5:ly=5:la=0.9:cx=3:cy=3:ca=0.35');
      pipelineSteps.push('محرك درع تيك توك المسبق (Pre-Emphasis): تعزيز الترددات المكانية الدقيقة لحماية التفاصيل قبل ضغط الخوادم');
    } else if (clarity === 'micro_contrast') {
      vfFilters.push('unsharp=lx=3:ly=3:la=0.6:cx=3:cy=3:ca=0.2', 'eq=contrast=1.03:brightness=0.005');
      pipelineSteps.push('محرك التباين المجهري (Micro-Contrast): إبراز ملامح الوجه والنصوص ثلاثية الأبعاد');
    } else if (clarity === 'pro_sharp') {
      vfFilters.push('unsharp=5:5:0.75:3:3:0.0');
      pipelineSteps.push('محرك الوضوح المتقدم (Pro Sharp): تعزيز حدة الحواف الرئيسية');
    } else if (clarity === 'subtle') {
      vfFilters.push('unsharp=3:3:0.35:3:3:0.0');
      pipelineSteps.push('محرك الوضوح الناعم (Subtle): صقل متوازن للحدود');
    }

    vfFilters.push('format=yuv420p');
    pipelineSteps.push('توحيد نسق البكسل القياسي (YUV 4:2:0 - BT.709)');

    args.push('-vf', vfFilters.join(','));
    args.push('-map', '0:v');
  }

  // Audio mapping
  args.push('-map', '0:a?');

  // Video Codec & Encoding Parameters
  let videoEncoder = settings.videoCodec === 'libx265' ? 'libx265' : 'libx264';
  if (hw.hasNvidiaGpu && (settings.videoCodec as any) === 'h264_nvenc') {
    videoEncoder = 'h264_nvenc';
  }

  args.push('-c:v', videoEncoder);

  if (videoEncoder === 'libx264') {
    args.push('-profile:v', 'high', '-level', '4.2');
  }

  // Preset configuration
  let x264Preset = 'veryfast';
  if (speed === 'turbo') {
    x264Preset = 'ultrafast';
  } else if (speed === 'balanced') {
    x264Preset = 'veryfast';
  } else {
    x264Preset = hw.hasNvidiaGpu ? 'slow' : 'medium';
  }

  // Rate control & Strict VBV Envelope
  if (videoEncoder === 'h264_nvenc') {
    args.push('-preset', 'p4', '-cq', settings.crfValue.toString());
  } else if (settings.rateControl === 'crf') {
    args.push('-crf', settings.crfValue.toString());
    if (settings.maxBitrateKbps) {
      args.push('-maxrate', `${settings.maxBitrateKbps}k`, '-bufsize', `${Math.round(settings.maxBitrateKbps * 1.25)}k`);
    }
    args.push('-preset', x264Preset);
  } else {
    const br = settings.targetBitrateKbps || 12000;
    const maxBr = settings.maxBitrateKbps || 16000;
    args.push('-b:v', `${br}k`, '-maxrate', `${maxBr}k`, '-bufsize', `${maxBr * 2}k`, '-preset', x264Preset);
  }

  // Compression Guard (x264 Psy Engine & AQ Mode)
  if (settings.compressionGuard && videoEncoder === 'libx264') {
    args.push('-tune', 'film');
    if (speed !== 'turbo') {
      args.push('-x264-params', 'aq-mode=3:aq-strength=1.0:psy-rd=1.0,0.15');
    }
    pipelineSteps.push('محرك درع الضغط (Adaptive Quantization 3): منع تكسر الألوان والظلال في الشاشات الداكنة');
  }

  // Explicit Rec.709 color metadata
  args.push(
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv'
  );

  // Keyframe / Closed GOP intervals for TikTok HLS chunks
  const gop = settings.gopSize || (settings.targetFps === 30 ? 60 : 120);
  args.push('-g', gop.toString(), '-keyint_min', gop.toString(), '-sc_threshold', '0', '-flags', '+cgop');
  pipelineSteps.push(`تثبيت الإطارات المفتاحية GOP = ${gop} مع إغلاق الـ GOP (+cgop)`);

  // Audio Studio Engine (Mastering & Vocal Enhancer)
  if (meta.audioCodec && meta.audioCodec !== 'none') {
    if (settings.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
      pipelineSteps.push('تمرير مسار الصوت الأصلي دون تعديل');
    } else {
      const audioEngine = settings.audioEngine || 'tiktok_loudnorm';
      const audioFilters: string[] = [];

      if (audioEngine === 'tiktok_loudnorm') {
        audioFilters.push('highpass=f=45,lowpass=f=18500,loudnorm=I=-14:LRA=10:TP=-1.5');
        pipelineSteps.push('تطبيع الصوت القياسي لـ -14 LUFS مع فلترة الترددات تحت الصوتية وفوق الصوتية');
      } else if (audioEngine === 'vocal_clarity') {
        audioFilters.push(
          'highpass=f=75',
          'equalizer=f=2800:t=q:w=1.2:g=2.8',
          'equalizer=f=4500:t=q:w=1.5:g=1.5',
          'loudnorm=I=-14:LRA=8:TP=-1.5'
        );
        pipelineSteps.push('محرك وضوح الصوت البشري (Vocal Clarity): إبراز نبرة الصوت وتطبيع -14 LUFS');
      } else if (audioEngine === 'bass_and_music') {
        audioFilters.push(
          'bass=g=2.5:f=90:w=0.6',
          'treble=g=1.5:f=10000:w=0.8',
          'loudnorm=I=-13:LRA=11:TP=-1.0'
        );
        pipelineSteps.push('محرك الإيقاع والموسيقى (Bass & Music Booster): تضخيم البيس وتنقية الإيقاعات بـ -13 LUFS');
      } else if (audioEngine === 'studio_master') {
        audioFilters.push(
          'highpass=f=40',
          'equalizer=f=250:t=q:w=1.0:g=-1.0',
          'equalizer=f=3200:t=q:w=1.2:g=1.8',
          'loudnorm=I=-14:LRA=9:TP=-1.5'
        );
        pipelineSteps.push('ماسترينغ الاستوديو الاحترافي (Studio Master): تصفية الرنين وتوحيد الديناميكية');
      }

      if (audioFilters.length > 0) {
        args.push('-af', audioFilters.join(','));
      }

      args.push('-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
      pipelineSteps.push(`ترميز الصوت AAC-LC ستيريو بمعدل ${settings.audioBitrateKbps} kbps و 48kHz`);
    }
  }

  // FastStart for instant playback
  if (settings.fastStart) {
    args.push('-movflags', '+faststart');
    pipelineSteps.push('تفعيل moov atom faststart للبدء الفوري');
  }

  args.push('-threads', '0');
  args.push(outputPath);

  return {
    args,
    pipelineDescriptionAr: pipelineSteps.join(' ➔ '),
  };
}
