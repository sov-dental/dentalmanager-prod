import React, { useState, useEffect, useRef } from 'react';
import { Clinic, Doctor, DailySchedule } from '../types';
import { ScheduleRenderer } from './ScheduleRenderer';
import { generateAnnouncement } from '../services/geminiService';
import { DEFAULT_STYLE_CONFIG } from '../services/storageService';
import { Download, Sparkles, Copy, X, Loader2, Image as ImageIcon } from 'lucide-react';
import html2canvas from 'html2canvas';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  clinic: Clinic | undefined;
  doctors: Doctor[];
  schedules: DailySchedule[];
  year: number;
  month: number;
}

export const PublishModal: React.FC<Props> = ({ isOpen, onClose, clinic, doctors, schedules, year, month }) => {
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(0.3); // Initial preview scale
  
  const containerRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset state when opening
      setGeneratedText('');
      // Auto-fit logic
      const updateScale = () => {
         if (containerRef.current && layoutData) {
             const parentWidth = containerRef.current.clientWidth;
             const parentHeight = containerRef.current.clientHeight;
             const availableW = Math.max(0, parentWidth - 32); 
             const availableH = Math.max(0, parentHeight - 32);
             const scaleW = availableW / layoutData.containerW;
             const scaleH = availableH / layoutData.containerH;
             setScaleFactor(Math.min(scaleW, scaleH, 0.5)); // Cap at 0.5 for preview
         }
      };
      // Slight delay to allow DOM to render
      setTimeout(updateScale, 100);
      window.addEventListener('resize', updateScale);
      return () => window.removeEventListener('resize', updateScale);
    }
  }, [isOpen]);

  if (!isOpen || !clinic) return null;

  const config = clinic.styleConfig || DEFAULT_STYLE_CONFIG;

  // Resolve Layout Data (Duplicate logic from ExportView for self-containment)
  let layoutData = null;
  let titleData = null;

  if (config.canvas_layout?.grid_area) {
      const cLayout = config.canvas_layout;
      layoutData = {
          x: cLayout.grid_area.x,
          y: cLayout.grid_area.y,
          width: cLayout.grid_area.width,
          height: cLayout.grid_area.height,
          containerW: cLayout.base_image_width || cLayout.container_width || 1080,
          containerH: cLayout.base_image_height || cLayout.container_height || 1350
      };
      if (cLayout.title_area) titleData = cLayout.title_area;
  } else if (config.canvasLayout) {
      layoutData = {
          x: config.canvasLayout.x,
          y: config.canvasLayout.y,
          width: config.canvasLayout.width,
          height: config.canvasLayout.height,
          containerW: config.canvasLayout.containerWidth,
          containerH: config.canvasLayout.containerHeight
      };
  }
  
  const containerWidth = layoutData?.containerW || 1080;
  const containerHeight = layoutData?.containerH || 1350;

  // Data Preparation
  const monthSchedules = schedules.filter(s => {
      const d = new Date(s.date);
      return s.clinicId === clinic.id && d.getMonth() === month && d.getFullYear() === year;
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const calendarCells = Array(firstDay).fill(null);
  for(let i=1; i<=daysInMonth; i++) calendarCells.push(i);
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  // Actions
  const handleGenerateText = async () => {
    setIsGenerating(true);
    const text = await generateAnnouncement(clinic, `${year}-${month+1}`, monthSchedules, doctors);
    setGeneratedText(text);
    setIsGenerating(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedText);
    alert('已複製到剪貼簿！');
  };

  const handleDownload = async () => {
    if (!exportRef.current) return;
    setIsDownloading(true);
    try {
        const canvas = await html2canvas(exportRef.current, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: null, 
            width: containerWidth,
            height: containerHeight,
            scrollX: 0, scrollY: 0, x: 0, y: 0,
        });
        const image = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = image;
        link.download = `schedule-${clinic.name}-${year}-${month+1}.png`;
        link.click();
    } catch (error) {
        console.error('Download error:', error);
        alert('圖片下載失敗');
    } finally {
        setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-slide-down">
        {/* Header */}
        <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <ImageIcon size={24} className="text-purple-400" />
            預覽與發布 ({year}年{month+1}月)
          </h3>
          <button onClick={onClose} className="hover:text-rose-300 transition-colors p-1 rounded-full hover:bg-slate-800">
            <X size={24} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* LEFT: AI Generator */}
          <div className="w-full lg:w-1/3 bg-slate-50 p-6 border-r border-slate-200 flex flex-col gap-4 overflow-y-auto">
             <div className="bg-gradient-to-br from-purple-50 to-indigo-50 p-5 rounded-xl border border-purple-100 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-purple-900">
                    <Sparkles className="text-purple-600" size={20} />
                    <h4 className="font-bold">AI 貼文小幫手</h4>
                </div>
                <p className="text-sm text-slate-600 mb-4">
                    自動分析本月班表，產生適合社群媒體 (FB/IG) 的吸睛貼文。
                </p>
                
                {!generatedText ? (
                    <button 
                        onClick={handleGenerateText}
                        disabled={isGenerating}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-bold transition-all shadow-md active:scale-95 flex justify-center items-center gap-2"
                    >
                        {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                        {isGenerating ? 'AI 撰寫中...' : '一鍵產生貼文'}
                    </button>
                ) : (
                    <div className="space-y-3 animate-fade-in">
                        <textarea 
                            className="w-full h-64 p-3 text-sm rounded-lg border-purple-200 focus:ring-2 focus:ring-purple-300 resize-none bg-white shadow-inner"
                            value={generatedText}
                            onChange={(e) => setGeneratedText(e.target.value)}
                        />
                        <div className="flex gap-2">
                            <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors">
                                <Copy size={16} /> 複製
                            </button>
                            <button onClick={() => setGeneratedText('')} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
                                重寫
                            </button>
                        </div>
                    </div>
                )}
             </div>

             <div className="mt-auto">
                 <button 
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-emerald-200 active:scale-95 transition-all flex justify-center items-center gap-3"
                 >
                     {isDownloading ? <Loader2 size={24} className="animate-spin"/> : <Download size={24} />}
                     {isDownloading ? '處理中...' : '下載排班表圖片'}
                 </button>
                 <p className="text-center text-xs text-slate-400 mt-2">高解析度 PNG 格式</p>
             </div>
          </div>

          {/* RIGHT: Preview */}
          <div className="w-full lg:w-2/3 bg-slate-200/50 relative flex items-center justify-center p-8 overflow-hidden" ref={containerRef}>
              <div 
                  className="shadow-2xl bg-white transition-transform duration-300 ease-out origin-center"
                  style={{
                      width: containerWidth * scaleFactor,
                      height: containerHeight * scaleFactor,
                  }}
              >
                 <div 
                    style={{
                        transform: `scale(${scaleFactor})`,
                        transformOrigin: 'top left',
                        width: containerWidth,
                        height: containerHeight,
                        overflow: 'hidden',
                        pointerEvents: 'none' // Prevent interaction in preview
                    }}
                >
                    <ScheduleRenderer
                        clinic={clinic}
                        config={config}
                        layoutData={layoutData}
                        titleData={titleData}
                        containerWidth={containerWidth}
                        containerHeight={containerHeight}
                        year={year}
                        month={month}
                        monthSchedules={monthSchedules}
                        calendarCells={calendarCells}
                        doctors={doctors}
                    />
                </div>
              </div>
          </div>
        </div>
      </div>

      {/* Hidden Render Target */}
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', zIndex: -1 }}>
          <div
                ref={exportRef}
                style={{
                position: 'relative',
                width: `${containerWidth}px`,
                height: `${containerHeight}px`,
                overflow: 'hidden',
                backgroundColor: 'transparent',
                }}
            >
                <ScheduleRenderer
                clinic={clinic}
                config={config}
                layoutData={layoutData}
                titleData={titleData}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                year={year}
                month={month}
                monthSchedules={monthSchedules}
                calendarCells={calendarCells}
                doctors={doctors}
                />
            </div>
      </div>
    </div>
  );
};