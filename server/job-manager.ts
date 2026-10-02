import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { VideoJob, JobProgress, JobPhase, ExportSettings, VideoMetadata, JobPriority } from './types';
import { probeVideo } from './prober';
import { detectHardwareProfile, buildFfmpegPipeline } from './ai-pipeline';
import { redisQueue } from './redis-queue';
import { getRifeEngineInfo, runRifeInterpolation } from './rife-engine';

class JobManager extends EventEmitter {
  private storageDir: string;
  private uploadsDir: string;
  private outputsDir: string;
  private activeJobsCount = 0;
  private maxConcurrency = 2;
  private isProcessingQueue = false;
  private runningJobIds = new Set<string>();

  constructor() {
    super();
    this.storageDir = path.join('/tmp', 'saf_storage');
    this.uploadsDir = path.join(this.storageDir, 'uploads');
    this.outputsDir = path.join(this.storageDir, 'outputs');

    fs.mkdirSync(this.uploadsDir, { recursive: true });
    fs.mkdirSync(this.outputsDir, { recursive: true });

    // Listen to queue events
    redisQueue.on('progress', (job: VideoJob) => {
      this.emit('progress', job);
    });

    redisQueue.on('autoResumed', (count: number) => {
      console.log(`[صــف JobManager] Auto-resumed ${count} interrupted jobs from queue.`);
      this.triggerQueueProcessor();
    });

    // Initial trigger for resumed jobs
    setTimeout(() => {
      this.triggerQueueProcessor();
    }, 1000);

    // Periodic queue check & cleanup of temp files older than 2 hours
    setInterval(() => {
      this.triggerQueueProcessor();
      this.cleanupOldFiles();
    }, 10000);
  }

  public getUploadsDir(): string {
    return this.uploadsDir;
  }

  public getOutputsDir(): string {
    return this.outputsDir;
  }

  public isJobRunning(jobId: string): boolean {
    return this.runningJobIds.has(jobId);
  }

  public getAllJobs(): VideoJob[] {
    return redisQueue.getAllJobs();
  }

  public getJob(id: string): VideoJob | undefined {
    return redisQueue.getJob(id);
  }

  public getQueueStats() {
    return redisQueue.getStats();
  }

  public async deleteJob(id: string): Promise<boolean> {
    const job = redisQueue.getJob(id);
    if (job) {
      this.runningJobIds.delete(id);
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        try {
          fs.unlinkSync(job.outputPath);
        } catch (e) {}
      }
    }
    return redisQueue.deleteJob(id);
  }

  public async createJob(
    originalName: string,
    inputPath: string,
    settings: ExportSettings,
    priority: JobPriority = 'normal'
  ): Promise<VideoJob> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const outputFilename = `saf_tiktok_${id}.mp4`;
    const outputPath = path.join(this.outputsDir, outputFilename);

    // Initial Probe
    const originalMetadata = await probeVideo(inputPath);

    const initialProgress: JobProgress = {
      phase: 'analyzing',
      phaseLabelAr: 'تحليل الفيديو',
      percent: 5,
      elapsedSeconds: 0,
      logMessage: 'جاري تسجيل المهمة في طابور الأولويات...',
    };

    const jobPriority = settings.priority || priority || 'normal';

    const job: VideoJob = {
      id,
      createdAt: Date.now(),
      originalName,
      inputPath,
      outputPath,
      originalMetadata,
      settings: {
        ...settings,
        priority: jobPriority,
      },
      status: 'queued',
      progress: initialProgress,
      priority: jobPriority,
      retryCount: 0,
      maxRetries: 3,
    };

    // Push into Redis / Memory Priority Queue
    await redisQueue.enqueue(job);

    // Trigger queue consumer asynchronously
    setImmediate(() => {
      this.triggerQueueProcessor();
    });

    return job;
  }

  public async triggerQueueProcessor(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.activeJobsCount < this.maxConcurrency) {
        const nextJob = await redisQueue.dequeue();
        if (!nextJob) break;

        // Skip if already running in active memory
        if (this.runningJobIds.has(nextJob.id)) continue;

        this.activeJobsCount++;
        this.runningJobIds.add(nextJob.id);

        this.runJob(nextJob)
          .catch(async (err) => {
            console.error(`Error executing job ${nextJob.id}:`, err);
            
            // Retry logic
            if ((nextJob.retryCount || 0) < (nextJob.maxRetries || 3)) {
              nextJob.retryCount = (nextJob.retryCount || 0) + 1;
              nextJob.status = 'queued';
              nextJob.progress.phaseLabelAr = `إعادة المحاولة تلقائياً (${nextJob.retryCount}/${nextJob.maxRetries})`;
              nextJob.progress.logMessage = `تعثرت المعالجة، جاري إعادة المحاولة...`;
              await redisQueue.updateJob(nextJob);
              this.emit('progress', nextJob);
            } else {
              nextJob.status = 'failed';
              nextJob.error = err.message || 'حدث خطأ أثناء معالجة الفيديو';
              nextJob.progress.phase = 'failed';
              nextJob.progress.phaseLabelAr = 'فشل المعالجة';
              await redisQueue.updateJob(nextJob);
              this.emit('progress', nextJob);
            }
          })
          .finally(() => {
            this.runningJobIds.delete(nextJob.id);
            this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
            this.triggerQueueProcessor();
          });
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async runJob(job: VideoJob): Promise<void> {
    job.status = 'processing';
    await redisQueue.updateJob(job);
    this.emit('progress', job);

    const startTime = Date.now();
    const hw = await detectHardwareProfile();

    // 1. Phase: Preparing Frames
    job.progress = {
      phase: 'preparing_frames',
      phaseLabelAr: job.resumedFromCrash ? 'استئناف المعالجة' : 'تجهيز الإطارات',
      percent: 15,
      elapsedSeconds: 0,
      logMessage: job.resumedFromCrash
        ? `جاري استئناف المعالجة تلقائيًا بأولوية ${job.priority === 'high' ? 'عالية' : 'قصوى'}...`
        : 'تجهيز مسارات المعالجة وتقسيم الإطارات...',
    };
    await redisQueue.updateJob(job);
    this.emit('progress', job);

    // 2. Check for Genuine RIFE AI Neural Interpolation
    const rifeInfo = getRifeEngineInfo();
    const shouldUseRife =
      job.settings.useAiInterpolation &&
      job.settings.targetFps === 60 &&
      job.originalMetadata.fps < 55 &&
      rifeInfo.isAvailable &&
      (job.settings.interpolationEngine === 'rife_ai' || !job.settings.interpolationEngine || job.settings.preset !== 'custom');

    if (shouldUseRife) {
      try {
        console.log(`[صــف RIFE AI] Starting genuine AI neural interpolation for job ${job.id}...`);
        await runRifeInterpolation(
          job.inputPath,
          job.outputPath!,
          job.originalMetadata,
          job.settings,
          async (prog) => {
            job.progress = {
              ...job.progress,
              phase: prog.phase as JobPhase,
              phaseLabelAr: prog.phaseLabelAr,
              percent: prog.percent,
              elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
              logMessage: prog.logMessage,
            };
            this.emit('progress', job);
            await redisQueue.updateJob(job);
          }
        );

        if (fs.existsSync(job.outputPath!)) {
          const stat = fs.statSync(job.outputPath!);
          if (stat.size > 0) {
            try {
              job.outputMetadata = await probeVideo(job.outputPath!);
            } catch (e) {
              console.error('Error probing RIFE output:', e);
            }
            job.status = 'completed';
            job.completedAt = Date.now();
            job.progress = {
              phase: 'completed',
              phaseLabelAr: 'اكتملت المعالجة بنجاح عبر RIFE AI',
              percent: 100,
              elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
              logMessage: 'تمت مضاعفة الإطارات إلى 60 FPS حقيقية بالذكاء الاصطناعي وتجهيز الفيديو لـ TikTok',
            };
            await redisQueue.updateJob(job);
            this.emit('progress', job);
            return;
          }
        }
      } catch (rifeErr) {
        console.warn(`[صــف RIFE AI] Warning: RIFE execution failed, seamlessly falling back to high-performance pipeline:`, rifeErr);
      }
    }

    // Fallback or Standard FFmpeg Processing
    // Build FFmpeg command
    const { args } = buildFfmpegPipeline(
      job.inputPath,
      job.outputPath!,
      job.originalMetadata,
      job.settings,
      hw
    );

    // Add progress reporting argument
    const ffmpegArgs = ['-progress', 'pipe:1', ...args];
    const totalDuration = job.originalMetadata.duration || 5;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', ffmpegArgs);
      let buffer = '';
      let lastCheckpointTime = Date.now();

      proc.stdout.on('data', async (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const [key, rawValue] = line.trim().split('=');
          if (!key || rawValue === undefined) continue;
          const value = rawValue.trim();

          if (key === 'out_time_ms' || key === 'out_time_us') {
            const outTimeUnits = parseInt(value, 10);
            if (!isNaN(outTimeUnits) && outTimeUnits >= 0) {
              const currentTimeSec = outTimeUnits / 1000000;
              const progressRatio = Math.min(0.98, Math.max(0.05, currentTimeSec / totalDuration));
              const percent = Math.round(progressRatio * 100);
              const elapsed = Math.round((Date.now() - startTime) / 1000);

              // Determine Phase accurately
              let phase: JobPhase = 'processing_video';
              let phaseLabelAr = 'معالجة الفيديو';

              if (percent < 25) {
                phase = 'preparing_frames';
                phaseLabelAr = 'تجهيز الإطارات';
              } else if (percent < 55) {
                phase = job.settings.useAiInterpolation ? 'enhancing_motion' : 'processing_video';
                phaseLabelAr = job.settings.useAiInterpolation ? 'مضاعفة الإطارات لسلاسة 60 FPS' : 'معالجة الفيديو';
              } else if (percent < 85) {
                phase = 'processing_video';
                phaseLabelAr = 'معالجة الأبعاد والألوان لـ TikTok';
              } else {
                phase = 'encoding_output';
                phaseLabelAr = 'ترميز الملف النهائي';
              }

              job.progress = {
                ...job.progress,
                phase,
                phaseLabelAr,
                percent,
                elapsedSeconds: elapsed,
              };

              this.emit('progress', job);

              // Periodic persistence checkpoint every 3 seconds
              if (Date.now() - lastCheckpointTime > 3000) {
                lastCheckpointTime = Date.now();
                redisQueue.updateJob(job);
              }
            }
          } else if (key === 'fps') {
            const parsedFps = parseFloat(value);
            if (!isNaN(parsedFps)) job.progress.fps = parsedFps;
          } else if (key === 'frame') {
            const parsedFrame = parseInt(value, 10);
            if (!isNaN(parsedFrame)) job.progress.currentFrame = parsedFrame;
          } else if (key === 'speed') {
            job.progress.speed = value;
          }
        }
      });

      let stderrOutput = '';
      proc.stderr.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });

      proc.on('close', async (code) => {
        if (code === 0) {
          try {
            if (fs.existsSync(job.outputPath!)) {
              const outputMetadata = await probeVideo(job.outputPath!);
              job.outputMetadata = outputMetadata;
              job.status = 'completed';
              job.completedAt = Date.now();
              job.progress = {
                phase: 'completed',
                phaseLabelAr: 'اكتملت المعالجة بنجاح',
                percent: 100,
                elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
                logMessage: 'تم تجهيز الفيديو بكامل معايير TikTok القياسية',
              };

              await redisQueue.updateJob(job);
              this.emit('progress', job);
              resolve();
            } else {
              reject(new Error('لم يتم العثور على الملف الناتج بعد اكتمال المعالجة.'));
            }
          } catch (probeErr: any) {
            console.error('Error probing final output:', probeErr);
            job.status = 'completed';
            job.completedAt = Date.now();
            job.progress.percent = 100;
            job.progress.phase = 'completed';
            job.progress.phaseLabelAr = 'اكتملت المعالجة';
            await redisQueue.updateJob(job);
            this.emit('progress', job);
            resolve();
          }
        } else {
          console.error(`FFmpeg exited with code ${code}. Stderr: ${stderrOutput.slice(-300)}`);
          reject(new Error(`فشلت المعالجة برمز خطأ (${code}).`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async cleanupOldFiles(): Promise<number> {
    let deletedCount = 0;
    const maxAgeMs = 4 * 60 * 60 * 1000; // 4 hours safe retention
    const now = Date.now();

    // Never delete files belonging to active or queued jobs
    const activePaths = new Set<string>();
    for (const j of this.getAllJobs()) {
      if (j.status === 'processing' || j.status === 'queued') {
        if (j.inputPath) activePaths.add(path.resolve(j.inputPath));
        if (j.outputPath) activePaths.add(path.resolve(j.outputPath));
      }
    }

    const scanAndClean = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === 'sample_tiktok_clip.mp4') continue; // Preserve sample video
        const fullPath = path.join(dir, file);
        if (activePaths.has(path.resolve(fullPath))) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullPath);
            }
            deletedCount++;
          }
        } catch (e) {
          console.error(`Cleanup error on ${file}:`, e);
        }
      }
    };

    scanAndClean(this.uploadsDir);
    scanAndClean(this.outputsDir);

    return deletedCount;
  }
}

export const jobManager = new JobManager();
