
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Clinic, Doctor, DailySchedule } from '../types';
import { generateAnnouncement } from '../services/geminiService';
import { DEFAULT_STYLE_CONFIG } from '../services/storageService';
import { CLINIC_ORDER } from '../services/firebase';
import { Copy, Sparkles, ZoomIn, ZoomOut, Download } from 'lucide-react';
import html2canvas from 'html2canvas';
import { ScheduleRenderer } from './ScheduleRenderer';

interface Props {
  clinics: Clinic[];
  doctors: Doctor[];
  schedules: DailySchedule[];
}

export const ExportView: React.FC<Props> = ({ clinics, doctors, schedules }) => {
  const [selectedClinicId, setSelectedClinicId] = useState<string>('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Scaling & Download State
  const [scaleFactor, setScaleFactor] = useState(0.4); 
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Ref for the visible preview container
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref for the hidden, full-size export container
  const exportRef = useRef<HTMLDivElement>(null);

  // Sorting Helper
  const getSortOrder = (name: string) => CLINIC_ORDER[name] || 999;

  // Sorted Clinics for Dropdown
  const sortedClinics = useMemo(() => {
      return [...clinics].sort((a, b) => getSortOrder(a.name) - getSortOrder(b.name));
  }, [clinics]);

  useEffect(() => {
    if (sortedClinics.length > 0 && !selectedClinicId) setSelectedClinicId(sortedClinics[0].id);
  }, [sortedClinics]); // Re-select if list changes/reloads

  const selectedClinic = clinics.find(c => c.id === selectedClinicId);
  const config = selectedClinic?.styleConfig || DEFAULT_STYLE_CONFIG;

  // Resolve Layout Data
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
      if (cLayout.title_area) {
          titleData = cLayout.title_area;
      }
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

  // Auto-fit scale on mount/resize
  useEffect(() => {
     const updateScale = () => {
         if (containerRef.current) {
             const parentWidth = containerRef.current.clientWidth;
             const parentHeight = containerRef.current.clientHeight;
             
             // Leave some padding (e.g., 64px)
             const availableW = Math.max(0, parentWidth - 64); 
             const availableH = Math.max(0, parentHeight - 64);
             
             const scaleW = availableW / containerWidth;
             const scaleH = availableH / containerHeight;
             
             // Fit containment (show full image without scroll initially)
             const scale = Math.min(scaleW, scaleH, 1); 
             
             setScaleFactor(Math.max(0.1, scale));
         }
     };
     
     updateScale();
     window.addEventListener('resize', updateScale);
     return () => window.removeEventListener('resize', updateScale);
  }, [containerWidth, containerHeight, selectedClinicId]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthSchedules = schedules.filter(s => {
      const d = new Date(s.date);
      return s.clinicId === selectedClinicId && d.getMonth() === month && d.getFullYear() === year;
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const calendarCells = Array(firstDay).fill(null);
  for(let i=1; i<=daysInMonth; i++) calendarCells.push(i);
  
  // Pad the end to make a complete rectangle (optional but looks better for borders)
  while (calendarCells.length % 7 !== 0) {
      calendarCells.push(null);
  }

  const handleGenerateText = async () => {
    if(!selectedClinic) return;
    setIsGenerating(true);
    setGeneratedText('');
    const text = await generateAnnouncement(selectedClinic, `${year}-${month+1}`, monthSchedules, doctors);
    setGeneratedText(text);
    setIsGenerating(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedText);
    alert('已複製到剪貼簿！');
  };

  const handleDownload = async () => {
    // CAPTURE FROM THE HIDDEN REF
    if (!exportRef.current) return;
    setIsDownloading(true);

    try {
        const canvas = await html2canvas(exportRef.current, {
            scale: 2, // High resolution (2x the pixel dimensions)
            useCORS: true, // Needed for external images
            allowTaint: true,
            backgroundColor: null, 
            width: containerWidth,
            height: containerHeight,
            // Capture from top-left of the hidden element
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
        });

        const image = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = image;
        link.download = `schedule-${selectedClinic?.name}-${year}-${month+1}.png`;
        link.click();
    } catch (error) {
        console.error('Download error:', error);
        alert('圖片下載失敗，請稍後再試。');
    } finally {
        setIsDownloading(false);
    }
  };

  if (!selectedClinic) return <div className="p-8">請先選擇診所。</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Left: Controls & Text Generation */}
      <div className="w-full lg:w-1/3 space-y-6 flex-shrink-0">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold mb-4">匯出設定</h2>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">診所</label>
                    <select
                        className="w-full border p-2 rounded-lg"
                        value={selectedClinicId}
                        onChange={e => setSelectedClinicId(e.target.value)}
                    >
                        {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">月份</label>
                    <input 
                        type="month" 
                        value={`${year}-${String(month+1).padStart(2,'0')}`}
                        onChange={(e) => {
                            if(e.target.value) setCurrentDate(new Date(e.target.value + '-01'));
                        }}
                        className="w-full border p-2 rounded-lg"
                    />
                </div>
                <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div className="flex justify-between mb-1">
                        <span>原始尺寸:</span>
                        <span className="font-mono text-slate-700">{containerWidth} x {containerHeight} px</span>
                    </div>
                </div>
            </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-6 rounded-xl shadow-sm border border-indigo-100">
            <div className="flex items-center gap-2 mb-4 text-indigo-900">
                <Sparkles className="text-indigo-600" />
                <h2 className="text-lg font-bold">AI 文案產生器</h2>
            </div>
            
            {!generatedText ? (
                <button 
                    onClick={handleGenerateText}
                    disabled={isGenerating}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-70 flex justify-center items-center gap-2"
                >
                    {isGenerating ? <span className="animate-spin">⏳</span> : <Sparkles size={18} />}
                    {isGenerating ? '撰寫中...' : '產生文案'}
                </button>
            ) : (
                <div className="space-y-3 animate-fade-in">
                    <textarea 
                        className="w-full h-48 p-3 text-sm rounded-lg border-indigo-200 focus:ring-2 focus:ring-indigo-300 resize-none bg-white"
                        value={generatedText}
                        onChange={(e) => setGeneratedText(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium">
                            <Copy size={16} /> 複製
                        </button>
                        <button onClick={() => setGeneratedText('')} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800">
                            重置
                        </button>
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Right: The Universal Visual Renderer */}
      <div className="w-full lg:w-2/3 bg-slate-100 rounded-xl overflow-hidden flex flex-col relative border border-slate-200 min-h-[800px]">
        <div className="bg-slate-800 p-4 flex justify-between items-center text-white shrink-0 z-20">
            <div className="flex items-center gap-6">
                <h3 className="font-semibold">預覽</h3>
                {/* Scale Controls */}
                <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-1 border border-slate-600">
                    <ZoomOut size={16} className="cursor-pointer hover:text-teal-300" onClick={() => setScaleFactor(s => Math.max(0.1, s - 0.1))} />
                    <input 
                        type="range" 
                        min="0.1" 
                        max="1.5" 
                        step="0.05" 
                        value={scaleFactor} 
                        onChange={e => setScaleFactor(parseFloat(e.target.value))}
                        className="w-24 h-1 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-teal-500"
                    />
                    <ZoomIn size={16} className="cursor-pointer hover:text-teal-300" onClick={() => setScaleFactor(s => Math.min(2.0, s + 0.1))} />
                    <span className="text-xs w-10 text-right font-mono">{Math.round(scaleFactor * 100)}%</span>
                </div>
            </div>
            
            <button 
                onClick={handleDownload}
                disabled={isDownloading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm border border-emerald-500"
            >
                {isDownloading ? (
                    <>
                        <span className="animate-spin text-white">⏳</span> 處理中...
                    </>
                ) : (
                    <>
                        <Download size={16} /> 下載圖片 (PNG)
                    </>
                )}
            </button>
        </div>
        
        {/* Preview Container with auto-scroll */}
        <div className="flex-1 overflow-auto flex justify-center p-8 bg-slate-200/50 relative" ref={containerRef}>
            <div 
                style={{
                    width: containerWidth * scaleFactor,
                    height: containerHeight * scaleFactor,
                    transition: 'width 0.2s, height 0.2s'
                }}
                className="relative shadow-2xl bg-white shrink-0"
            >
                <div 
                    style={{
                        transform: `scale(${scaleFactor})`,
                        transformOrigin: 'top left',
                        width: containerWidth,
                        height: containerHeight,
                        overflow: 'hidden'
                    }}
                >
                    <ScheduleRenderer
                        clinic={selectedClinic}
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

        {/* 
            HIDDEN TWIN FOR EXPORT
            Rendered off-screen with original dimensions (no transforms)
        */}
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
                    clinic={selectedClinic}
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
  );
};
