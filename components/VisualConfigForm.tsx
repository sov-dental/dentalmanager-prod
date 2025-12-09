

import React, { useState } from 'react';
import { ClinicStyleConfig } from '../types';
import { Type, Sliders, Palette, ChevronDown, ChevronUp, Move } from 'lucide-react';

interface Props {
  config: ClinicStyleConfig;
  onChange: (newConfig: ClinicStyleConfig) => void;
}

// Helper to parse "10px" -> 10
const parsePx = (val: string | undefined): number => {
  if (!val) return 0;
  return parseInt(val.replace('px', ''), 10) || 0;
};

// Helper to format 10 -> "10px"
const toPx = (val: number): string => `${val}px`;

// Helper Component for Color + Hex Input
const ColorInputGroup = ({ label, value, onChange }: { label: string, value: string, onChange: (val: string) => void }) => {
  // Ensure the color picker gets a valid hex or defaults to black. 
  // Browser color inputs don't support rgba, so we fallback safely while preserving the actual text value in the text input.
  const pickerValue = (value && value.startsWith('#') && (value.length === 4 || value.length === 7)) ? value : '#000000';

  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative w-10 h-9 shrink-0">
          <input
            type="color"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={pickerValue}
            onChange={(e) => onChange(e.target.value)}
          />
          <div 
            className="w-full h-full rounded border shadow-sm"
            style={{ backgroundColor: value || 'transparent' }}
          />
        </div>
        <input
          type="text"
          className="w-full border rounded px-2 py-1.5 text-sm font-mono uppercase focus:ring-2 focus:ring-teal-500 outline-none"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000 or rgba(...)"
        />
      </div>
    </div>
  );
};

const FONT_OPTIONS = [
    { label: '圓體 (可愛風)', value: '"M PLUS Rounded 1c", sans-serif' },
    { label: '昭源圓體 (進階)', value: '"Chiron GoRound TC", "M PLUS Rounded 1c", sans-serif' },
    { label: '黑體 (標準)', value: '"Noto Sans TC", sans-serif' },
    { label: '明體 (優雅)', value: '"Noto Serif TC", serif' },
];

export const VisualConfigForm: React.FC<Props> = ({ config, onChange }) => {
  const [activeTab, setActiveTab] = useState<'typography' | 'tuning' | 'canvas' | 'palette'>('typography');
  const [isExpanded, setIsExpanded] = useState(true);

  // Generic deep update helper
  const updateConfig = (path: string, value: any) => {
    const newConfig = JSON.parse(JSON.stringify(config)); // Deep clone
    const parts = path.split('.');
    let current = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    onChange(newConfig);
  };

  if (!isExpanded) {
      return (
          <button 
            onClick={() => setIsExpanded(true)}
            className="w-full bg-slate-50 p-2 rounded-lg text-sm text-slate-500 flex justify-between items-center hover:bg-slate-100"
          >
              <span className="font-semibold">顯示視覺設定編輯器</span>
              <ChevronDown size={16} />
          </button>
      )
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Header / Tabs */}
      <div className="flex bg-slate-50 border-b border-slate-200">
          <button 
            onClick={() => setActiveTab('typography')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'typography' ? 'bg-white text-teal-600 border-b-2 border-teal-600' : 'text-slate-500 hover:bg-slate-100'}`}
          >
              <Type size={14} /> 字體與排版
          </button>
          <button 
            onClick={() => setActiveTab('tuning')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'tuning' ? 'bg-white text-teal-600 border-b-2 border-teal-600' : 'text-slate-500 hover:bg-slate-100'}`}
          >
              <Sliders size={14} /> 精細校正
          </button>
          <button 
            onClick={() => setActiveTab('canvas')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'canvas' ? 'bg-white text-teal-600 border-b-2 border-teal-600' : 'text-slate-500 hover:bg-slate-100'}`}
          >
              <Move size={14} /> 畫布設定
          </button>
          <button 
            onClick={() => setActiveTab('palette')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'palette' ? 'bg-white text-teal-600 border-b-2 border-teal-600' : 'text-slate-500 hover:bg-slate-100'}`}
          >
              <Palette size={14} /> 顏色
          </button>
          <button onClick={() => setIsExpanded(false)} className="px-3 text-slate-400 hover:text-slate-600">
              <ChevronUp size={16} />
          </button>
      </div>

      <div className="p-4 space-y-4">
        {/* SECTION 1: TYPOGRAPHY & SPACING */}
        {activeTab === 'typography' && (
            <div className="space-y-4 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">標題字體 (Month/Title)</label>
                        <select 
                            className="w-full border rounded px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none"
                            value={config.typography.titleFont || config.typography.fontFamily}
                            onChange={e => updateConfig('typography.titleFont', e.target.value)}
                        >
                            {FONT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">內文字體 (Body/Grid)</label>
                        <select 
                            className="w-full border rounded px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none"
                            value={config.typography.bodyFont || config.typography.fontFamily}
                            onChange={e => updateConfig('typography.bodyFont', e.target.value)}
                        >
                            {FONT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">列表上距 (List Top Margin)</label>
                        <div className="flex items-center gap-2">
                            <input 
                                type="number" 
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={parsePx(config.spacing?.doctorListTopMargin)}
                                onChange={e => updateConfig('spacing.doctorListTopMargin', toPx(Number(e.target.value)))}
                            />
                            <span className="text-xs text-slate-400">px</span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">行距 (Row Gap)</label>
                        <div className="flex items-center gap-2">
                            <input 
                                type="number" 
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={parsePx(config.spacing?.doctorRowGap)}
                                onChange={e => updateConfig('spacing.doctorRowGap', toPx(Number(e.target.value)))}
                            />
                            <span className="text-xs text-slate-400">px</span>
                        </div>
                    </div>
                </div>
                
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">標題大小 (Title Size)</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={config.canvas_layout?.title_area?.font_size || 48}
                                onChange={e => updateConfig('canvas_layout.title_area.font_size', Number(e.target.value))}
                            />
                            <span className="text-xs text-slate-400">px</span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">表頭大小 (Header Size)</label>
                         <div className="flex items-center gap-2">
                            <input 
                                type="number" 
                                className="w-full border rounded px-3 py-2 text-sm"
                                value={parsePx(config.typography.gridHeaderSize)}
                                onChange={e => updateConfig('typography.gridHeaderSize', toPx(Number(e.target.value)))}
                            />
                            <span className="text-xs text-slate-400">px</span>
                        </div>
                    </div>
                 </div>
            </div>
        )}

        {/* SECTION 2: FINE TUNING */}
        {activeTab === 'tuning' && (
            <div className="space-y-4 animate-fade-in">
                <p className="text-xs text-slate-400 mb-2">使用正負值來微調元素的垂直位置 (Y軸)。</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">表頭文字 Y</label>
                        <input 
                            type="number" 
                            step="1"
                            className="w-full border rounded px-2 py-2 text-sm"
                            value={parsePx(config.corrections?.headerTextY)}
                            onChange={e => updateConfig('corrections.headerTextY', toPx(Number(e.target.value)))}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">醫師姓名 Y</label>
                         <input 
                            type="number" 
                            step="1"
                            className="w-full border rounded px-2 py-2 text-sm"
                            value={parsePx(config.corrections?.doctorNameY)}
                            onChange={e => updateConfig('corrections.doctorNameY', toPx(Number(e.target.value)))}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">點點容器 Y</label>
                         <input 
                            type="number" 
                            step="1"
                            className="w-full border rounded px-2 py-2 text-sm"
                            value={parsePx(config.corrections?.dotContainerY)}
                            onChange={e => updateConfig('corrections.dotContainerY', toPx(Number(e.target.value)))}
                        />
                    </div>
                     <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">點點內文 Y</label>
                         <input 
                            type="number" 
                            step="1"
                            className="w-full border rounded px-2 py-2 text-sm"
                            value={parsePx(config.corrections?.dotTextY)}
                            onChange={e => updateConfig('corrections.dotTextY', toPx(Number(e.target.value)))}
                        />
                    </div>
                </div>
            </div>
        )}

        {/* SECTION 3: CANVAS LAYOUT */}
        {activeTab === 'canvas' && (
            <div className="space-y-4 animate-fade-in">
                 <div className="border-b border-slate-100 pb-3 mb-3">
                    <h4 className="text-xs font-bold text-teal-600 uppercase mb-3">Grid (表格區域)</h4>
                    <div className="grid grid-cols-4 gap-3">
                         <div>
                            <label className="block text-[10px] text-slate-400 uppercase">X</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.grid_area?.x || 0}
                                onChange={e => updateConfig('canvas_layout.grid_area.x', Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 uppercase">Y</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.grid_area?.y || 0}
                                onChange={e => updateConfig('canvas_layout.grid_area.y', Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 uppercase">Width</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.grid_area?.width || 0}
                                onChange={e => updateConfig('canvas_layout.grid_area.width', Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 uppercase">Height</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.grid_area?.height || 0}
                                onChange={e => updateConfig('canvas_layout.grid_area.height', Number(e.target.value))}
                            />
                        </div>
                    </div>
                 </div>

                 <div>
                    <h4 className="text-xs font-bold text-teal-600 uppercase mb-3">Title (標題區域)</h4>
                    <div className="grid grid-cols-4 gap-3">
                         <div>
                            <label className="block text-[10px] text-slate-400 uppercase">X</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.title_area?.x || 0}
                                onChange={e => updateConfig('canvas_layout.title_area.x', Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 uppercase">Y</label>
                            <input 
                                type="number" 
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={config.canvas_layout?.title_area?.y || 0}
                                onChange={e => updateConfig('canvas_layout.title_area.y', Number(e.target.value))}
                            />
                        </div>
                        <div className="col-span-2">
                             <label className="block text-[10px] text-slate-400 uppercase">Text Template</label>
                             <input 
                                type="text" 
                                className="w-full border rounded px-2 py-1 text-sm font-mono text-slate-600"
                                value={config.canvas_layout?.title_area?.text || '{month}月'}
                                onChange={e => updateConfig('canvas_layout.title_area.text', e.target.value)}
                            />
                        </div>
                    </div>
                 </div>
            </div>
        )}

        {/* SECTION 4: PALETTE */}
        {activeTab === 'palette' && (
             <div className="space-y-4 animate-fade-in">
                 {/* NEW: Text Colors Group */}
                 <div>
                    <h4 className="text-xs font-bold text-teal-600 uppercase mb-3">文字顏色 (Text Colors)</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <ColorInputGroup 
                            label="主標題 (Title)" 
                            value={config.canvas_layout?.title_area?.color || '#000000'}
                            onChange={v => updateConfig('canvas_layout.title_area.color', v)}
                        />
                        <ColorInputGroup 
                            label="表頭文字 (Header)" 
                            value={config.palette.gridHeaderText}
                            onChange={v => updateConfig('palette.gridHeaderText', v)}
                        />
                        <ColorInputGroup 
                            label="內文/醫師 (Body)" 
                            value={config.palette.text}
                            onChange={v => updateConfig('palette.text', v)}
                        />
                         <ColorInputGroup 
                            label="休診字樣 (Closed)" 
                            value={config.palette.weekend?.sunday || '#f43f5e'}
                            onChange={v => updateConfig('palette.weekend.sunday', v)}
                        />
                    </div>
                    
                    <div className="mt-4 grid grid-cols-3 gap-3">
                         <ColorInputGroup 
                            label="平日日期" 
                            value={config.palette.dateText?.weekday || config.palette.text}
                            onChange={v => updateConfig('palette.dateText.weekday', v)}
                        />
                         <ColorInputGroup 
                            label="週六日期" 
                            value={config.palette.dateText?.saturday || config.palette.weekend?.saturday || '#10b981'}
                            onChange={v => updateConfig('palette.dateText.saturday', v)}
                        />
                         <ColorInputGroup 
                            label="週日日期" 
                            value={config.palette.dateText?.sunday || config.palette.weekend?.sunday || '#f43f5e'}
                            onChange={v => updateConfig('palette.dateText.sunday', v)}
                        />
                    </div>
                 </div>
                 
                 <div className="border-t border-slate-100 pt-3">
                     <h4 className="text-xs font-bold text-teal-600 uppercase mb-3">班別顏色 (Shift Colors)</h4>
                     <div className="grid grid-cols-3 gap-3">
                        <ColorInputGroup 
                            label="早診" 
                            value={config.shifts?.styles?.morning?.color || '#FBBF24'}
                            onChange={v => updateConfig('shifts.styles.morning.color', v)}
                        />
                        <ColorInputGroup 
                            label="午診" 
                            value={config.shifts?.styles?.afternoon?.color || '#EDBE5F'}
                            onChange={v => updateConfig('shifts.styles.afternoon.color', v)}
                        />
                        <ColorInputGroup 
                            label="晚診" 
                            value={config.shifts?.styles?.evening?.color || '#EFACB6'}
                            onChange={v => updateConfig('shifts.styles.evening.color', v)}
                        />
                     </div>
                 </div>
                 
                 <div className="border-t border-slate-100 pt-3">
                     <h4 className="text-xs font-bold text-teal-600 uppercase mb-3">表格網格 (Grid)</h4>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">表頭圓角 (Header Style)</label>
                            <select
                                className="w-full border rounded px-3 py-2 text-sm bg-white outline-none"
                                value={config.layout?.headerCornerStyle || 'rounded-top'}
                                onChange={e => updateConfig('layout.headerCornerStyle', e.target.value)}
                            >
                                <option value="rounded-top">上方圓角 (Default)</option>
                                <option value="rounded-all">全圓角 (Capsule)</option>
                                <option value="squared">直角 (Sharp)</option>
                            </select>
                        </div>
                         <ColorInputGroup 
                            label="邊框顏色" 
                            value={config.palette.gridBorder}
                            onChange={v => updateConfig('palette.gridBorder', v)}
                        />
                        <ColorInputGroup 
                            label="表頭背景" 
                            value={config.palette.gridHeaderBg}
                            onChange={v => updateConfig('palette.gridHeaderBg', v)}
                        />
                        <div className="col-span-2">
                            <ColorInputGroup 
                                label="表格底色 (Grid Background)" 
                                value={config.palette.gridBackground || ''}
                                onChange={v => updateConfig('palette.gridBackground', v)}
                            />
                             <p className="text-[10px] text-slate-400 mt-1">
                                可輸入色碼 (例如 #FFFFFF) 或透明度 (例如 rgba(255, 255, 255, 0.8))
                            </p>
                        </div>
                     </div>
                 </div>
             </div>
        )}
      </div>
    </div>
  );
};
