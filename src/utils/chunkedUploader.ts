import { VideoMetadata } from '../types';
import { getApiUrl } from './api';

export interface UploadProgress {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  currentChunk: number;
  totalChunks: number;
}

export interface UploadResult {
  uploadedFile: {
    originalName: string;
    savedPath: string;
    size: number;
  };
  metadata: VideoMetadata;
}

const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB chunks for optimal mobile uploading & proxy tolerance
const MAX_CHUNK_RETRIES = 3;

/**
 * Uploads a video file in resilient 6MB chunks with automatic retry on mobile/slow networks.
 * Provides real-time progress reporting.
 */
export async function uploadVideoChunked(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const totalBytes = file.size;
  const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  let uploadedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalBytes);
    const chunkBlob = file.slice(start, end);

    let lastError: Error | null = null;
    let chunkSuccess = false;
    let chunkData: any = null;

    // Retry loop per chunk (up to 3 attempts with exponential backoff)
    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('totalChunks', totalChunks.toString());
        formData.append('filename', file.name);
        formData.append('chunk', chunkBlob, file.name);

        const targetUrl = getApiUrl('/api/upload/chunk');
        const response = await fetch(targetUrl, {
          method: 'POST',
          body: formData,
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          if (text.includes('<!DOCTYPE') || text.includes('<html') || response.status === 404) {
            throw new Error('تعذر الاتصال بخادم الرفع. يرجى التأكد من استمرار تشغيل الخادم.');
          }
          throw new Error(`خطأ من الخادم أثناء رفع المقطع (${response.status}): ${text.slice(0, 100)}`);
        }

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || `فشل في رفع القطعة ${chunkIndex + 1}`);
        }

        chunkData = data;
        chunkSuccess = true;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_CHUNK_RETRIES) {
          // Wait before retrying
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (!chunkSuccess) {
      throw lastError || new Error(`فشل رفع القطعة ${chunkIndex + 1} بعد ${MAX_CHUNK_RETRIES} محاولات.`);
    }

    uploadedBytes += (end - start);
    const currentPercent = Math.min(Math.round((uploadedBytes / totalBytes) * 100), 99);

    if (onProgress) {
      onProgress({
        percent: currentPercent,
        loadedBytes: uploadedBytes,
        totalBytes,
        currentChunk: chunkIndex + 1,
        totalChunks,
      });
    }

    if (chunkData?.done && chunkData?.uploadedFile && chunkData?.metadata) {
      if (onProgress) {
        onProgress({
          percent: 100,
          loadedBytes: totalBytes,
          totalBytes,
          currentChunk: totalChunks,
          totalChunks,
        });
      }
      return {
        uploadedFile: chunkData.uploadedFile,
        metadata: chunkData.metadata,
      };
    }
  }

  throw new Error('لم تكتمل عملية تجميع قطع الفيديو على الخادم.');
}
