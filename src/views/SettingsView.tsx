import React, { useEffect, useState } from 'react';
import { SystemHardwareInfo } from '../types';
import { fetchJson } from '../utils/api';
import {
  Cpu,
  HardDrive,
  Sliders,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [hardware, setHardware] = useState<SystemHardwareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleanedMessage, setCleanedMessage] = useState<string | null>(null);

  const fetchSystem = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<SystemHardwareInfo>('/api/system-info');
      setHardware(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystem();
  }, []);

  const handleClean = async () => {
    try {
      const data = await fetchJson<{ deletedCount: number }>('/api/cleanup', { method: 'POST' });
      setCleanedMessage(`تم تنظيف ${data.deletedCount} ملف بنجاح.`);
      setTimeout(() => setCleanedMessage(null), 4000);
      fetchSystem();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 text-right">
      <div className="border-b border-neutral-800/80 pb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          إعدادات المحرك والعتاد
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 mt-1">
          اكتشاف مواصفات الخادم، تسريع العتاد (GPU/CPU)، وإدارة التخزين المؤقت
        </p>
      </div>

      {/* Hardware Profile & Detection */}
      <div className="rounded-2xl border border-neutral-800 bg-[#0E131F] p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-rose-400" />
            <h3 className="text-base font-bold text-white">عتاد النظام وتسريع المعالجة</h3>
          </div>
          <button
            onClick={fetchSystem}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة الفحص</span>
          </button>
        </div>

        {loading ? (
          <div className="text-xs text-neutral-400 text-center py-6">جاري فحص العتاد...</div>
        ) : hardware ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1">
              <span className="text-neutral-500">طراز المعالج (CPU)</span>
              <p className="text-white font-medium truncate">{hardware.cpuModel}</p>
              <span className="text-[11px] text-emerald-400 font-mono">
                {hardware.cpuCores} أنوية معالجة متوازية
              </span>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1">
              <span className="text-neutral-500">تسريع كرت الشاشة (GPU)</span>
              <p className="text-white font-medium">
                {hardware.gpuAvailable ? hardware.gpuName || 'GPU مفعل' : 'مسار CPU متعدد الأنوية'}
              </p>
              <span className="text-[11px] text-neutral-400">
                {hardware.gpuAvailable ? 'تسريع عتادي NVENC/VAAPI' : 'معالجة عالية الكفاءة'}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1">
              <span className="text-neutral-500">الذاكرة العشوائية (RAM)</span>
              <p className="text-white font-mono font-medium">
                {hardware.freeMemMb} MB متاح / {hardware.totalMemMb} MB
              </p>
              <span className="text-[11px] text-emerald-400">سعة كافية لمعالجة الفيديوهات</span>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1">
              <span className="text-neutral-500">محرك FFmpeg Core</span>
              <p className="text-white font-mono font-medium">{hardware.ffmpegVersion}</p>
              <span className="text-[11px] text-rose-400">دعم H.264 High & minterpolate</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* AI Interpolation Policies & RIFE-NCNN-VULKAN Engine Card */}
      <div className="rounded-2xl border border-neutral-800 bg-[#0E131F] p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">محرك الذكاء الاصطناعي RIFE-NCNN-VULKAN المدمج</h3>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>AI Neural Active</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-300">
          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
            <div className="text-neutral-500 text-[11px]">حالة المحرك العصبي</div>
            <h4 className="font-bold text-white text-sm">RIFE-NCNN-VULKAN Core</h4>
            <p className="text-neutral-400 leading-relaxed text-[11px]">
              مدمج بالكامل في الخادم الخلفي ويعمل عبر واجهة Vulkan مع برنامج التظليل المتقدم Mesa LLVMPipe لتوليد إطارات 60 FPS حقيقية بالذكاء الاصطناعي.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
            <div className="text-neutral-500 text-[11px]">النماذج العصبية المثبتة</div>
            <h4 className="font-bold text-emerald-400 text-sm">RIFE v4 + v4.6 + v2.3</h4>
            <p className="text-neutral-400 leading-relaxed text-[11px]">
              نماذج التعلم العميق المتخصصة في حساب حركات البكسلات التكيفية (Bidirectional Motion Vectors) لمنع التقطيع وضبابية الحركة.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
            <div className="text-neutral-500 text-[11px]">آلية السلامة والتمرير المباشر</div>
            <h4 className="font-bold text-amber-400 text-sm">Smart Passthrough & Fallback</h4>
            <p className="text-neutral-400 leading-relaxed text-[11px]">
              إذا كان الفيديو 60 FPS مسبقاً، يتم تمريره فورياً خلال ثانية واحدة. وفي حال تعذر المعالجة العصبية لملفات ضخمة يتم التحويل التلقائي لمحرك التعويض الحركي السريع دون توقف.
            </p>
          </div>
        </div>
      </div>

      {/* Storage and Cleanup */}
      <div className="rounded-2xl border border-neutral-800 bg-[#0E131F] p-6 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-neutral-800 pb-4">
          <HardDrive className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold text-white">إدارة التخزين وسياسة الحذف التلقائي</h3>
        </div>

        <div className="space-y-4 text-xs">
          <p className="text-neutral-400 leading-relaxed">
            لحماية الخصوصية وتوفير المساحة، يتم حذف الملفات المرفوعة والفيديوهات المعالجة تلقائيًا بعد مرور ساعة واحدة من إنشائها. يمكنك أيضًا إفراغ التخزين يدويًا في أي وقت.
          </p>

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleClean}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-800/80 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 font-semibold transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>إفراغ كافة ملفات المعالجة المؤقتة الآن</span>
            </button>

            {cleanedMessage && (
              <span className="text-emerald-400 font-medium">{cleanedMessage}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
