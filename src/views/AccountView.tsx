import React, { useState, useEffect } from 'react';
import { User, ShieldCheck, Zap, Film, Award, Check, Settings, Sparkles } from 'lucide-react';
import { fetchJson } from '../utils/api';
import { VideoJob } from '../types';

export const AccountView: React.FC = () => {
  const [userName, setUserName] = useState(() => localStorage.getItem('saf_user_name') || 'صانع المحتوى');
  const [isEditing, setIsEditing] = useState(false);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Load real job history to compute actual statistics
  useEffect(() => {
    fetchJson<{ jobs: VideoJob[] }>('/api/jobs')
      .then((data) => {
        if (data && data.jobs) {
          setJobs(data.jobs);
        }
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totalEnhanced = jobs.filter((j) => j.status === 'completed').length;
  const fps60Enhanced = jobs.filter(
    (j) => j.status === 'completed' && (j.outputMetadata?.fps || 0) >= 59
  ).length;

  const handleSaveName = (newName: string) => {
    setUserName(newName);
    localStorage.setItem('saf_user_name', newName);
    setIsEditing(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 text-right">
      <div className="border-b border-neutral-800/80 pb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          الملف الشخصي والحساب
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 mt-1">
          إدارة حساب صانع المحتوى وإعدادات المنصة الشخصية
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Profile Card */}
        <div className="lg:col-span-4 rounded-2xl border border-neutral-800 bg-[#0E131F] p-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-rose-600 to-amber-600 border-2 border-rose-500 shadow-xl flex items-center justify-center text-white">
              <User className="w-12 h-12" />
            </div>
            <div>
              {isEditing ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    defaultValue={userName}
                    id="username_input"
                    className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-xs text-white text-center"
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('username_input') as HTMLInputElement;
                      if (input) handleSaveName(input.value);
                    }}
                    className="px-2 py-1 bg-rose-600 rounded text-[11px] text-white"
                  >
                    حفظ
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <h3 className="text-lg font-bold text-white">{userName}</h3>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-[10px] text-neutral-400 hover:text-white"
                  >
                    (تعديل)
                  </button>
                </div>
              )}
              <p className="text-xs text-neutral-400 mt-0.5">صانع ومحرر محتوى TikTok & Reels</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs font-semibold">
              <Award className="w-3.5 h-3.5" />
              <span>باقة المحترفين (Pro Studio Engine)</span>
            </div>
          </div>

          <div className="border-t border-neutral-800 pt-4 space-y-3 text-xs">
            <div className="flex justify-between text-neutral-400">
              <span>خادم المعالجة</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                FFmpeg Engine متصل وجاهز
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>استهلاك المعالجة</span>
              <span className="text-white font-mono">غير محدود (خادم خاص)</span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>الاحتفاظ بالملفات</span>
              <span className="text-neutral-300">ساعتان من وقت الإنشاء</span>
            </div>
          </div>
        </div>

        {/* Detailed Stats and Preferences */}
        <div className="lg:col-span-8 space-y-6">
          {/* Real Dynamic Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl border border-neutral-800 bg-[#0E131F] space-y-1">
              <div className="text-neutral-500 text-xs">الفيديوهات المعالجة في الخادم</div>
              <div className="text-2xl font-bold font-mono text-white">
                {loading ? '...' : totalEnhanced}
              </div>
              <div className="text-[11px] text-emerald-400">ترميز H.264 High القياسي</div>
            </div>

            <div className="p-5 rounded-2xl border border-neutral-800 bg-[#0E131F] space-y-1">
              <div className="text-neutral-500 text-xs">مقاطع بسلاسة 60 FPS</div>
              <div className="text-2xl font-bold font-mono text-rose-400">
                {loading ? '...' : fps60Enhanced}
              </div>
              <div className="text-[11px] text-neutral-400">مضاعفة سلاسة الحركة CFR</div>
            </div>

            <div className="p-5 rounded-2xl border border-neutral-800 bg-[#0E131F] space-y-1">
              <div className="text-neutral-500 text-xs">حالة طابور المهام</div>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {jobs.filter((j) => j.status === 'processing').length > 0 ? 'نشط' : 'مستقر'}
              </div>
              <div className="text-[11px] text-neutral-400">معالجة فورية دون تأخير</div>
            </div>
          </div>

          {/* Preferences */}
          <div className="rounded-2xl border border-neutral-800 bg-[#0E131F] p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-white border-b border-neutral-800 pb-3">
              إعدادات وميزات المعالجة
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
                <div>
                  <span className="font-semibold text-white block">
                    خوارزمية مقاومة ضغط تيك توك التكيفية
                  </span>
                  <span className="text-neutral-400 text-[11px]">
                    كبح ذروة البث عند 14,000 kbps وتثبيت مسافة GOP عند 2.0 ثانية
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-semibold text-[11px]">
                  <Check className="w-3.5 h-3.5" />
                  <span>مفعلة</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-900/60 border border-neutral-800">
                <div>
                  <span className="font-semibold text-white block">
                    تطبيع مستوى الصوت (-14 LUFS EBU R128)
                  </span>
                  <span className="text-neutral-400 text-[11px]">
                    مطابقة معيار الصوت الرسمي لتجنب تشويه أو كتم الصوت في التطبيق
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-semibold text-雌11px]">
                  <Check className="w-3.5 h-3.5" />
                  <span>مفعلة</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
