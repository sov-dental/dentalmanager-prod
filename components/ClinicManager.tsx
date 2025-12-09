
import React, { useState } from 'react';
import { Clinic, DailyHours, ClinicStyleConfig } from '../types';
import { DEFAULT_STYLE_CONFIG } from '../services/storageService';
import { uploadImage } from '../services/firebase';
import { VisualConfigForm } from './VisualConfigForm';
import { MapPin, Phone, Plus, Check, X, Link as LinkIcon, Image as ImageIcon, Edit2, Palette, Code, Upload, Loader2, Users } from 'lucide-react';
import { useClinic } from '../contexts/ClinicContext';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  clinics: Clinic[]; // Compatibility
  onSave: (clinics: Clinic[]) => Promise<void>;
}

const DAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `clinic_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export const ClinicManager: React.FC<Props> = ({ onSave }) => {
  const { clinics } = useClinic();
  const { userRole } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [newClinic, setNewClinic] = useState<Partial<Clinic>>({
    id: '', 
    name: '',
    weeklyHours: Array(7).fill({ Morning: true, Afternoon: true, Evening: true }),
    themeColor: '#0d9488',
    styleConfig: DEFAULT_STYLE_CONFIG,
    googleCalendarMapping: {},
    allowedUsers: []
  });

  const [styleJson, setStyleJson] = useState(JSON.stringify(DEFAULT_STYLE_CONFIG, null, 2));
  const [emailInput, setEmailInput] = useState('');

  const initNewClinic = () => {
    setNewClinic({ 
        id: generateId(), 
        name: '', 
        weeklyHours: Array(7).fill({ Morning: true, Afternoon: true, Evening: true }), 
        themeColor: '#0d9488', 
        address: '', 
        phone: '',
        lineUrl: '',
        scheduleImageUrl: '',
        logoUrl: '',
        shiftColors: {
            morning: '#fbbf24',
            afternoon: '#fb923c',
            evening: '#818cf8'
        },
        styleConfig: DEFAULT_STYLE_CONFIG,
        googleCalendarMapping: {},
        allowedUsers: []
    });
    setStyleJson(JSON.stringify(DEFAULT_STYLE_CONFIG, null, 2));
    setEmailInput('');
    setEditingId(null);
    setShowJsonEditor(false);
    setJsonError(null);
    setIsUploading(false);
    setIsAdding(true); 
  };

  const closeForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setJsonError(null);
    setIsUploading(false);
    setIsSaving(false);
  };

  const handleEdit = (clinic: Clinic) => {
    const config = clinic.styleConfig || DEFAULT_STYLE_CONFIG;
    setNewClinic({
        id: clinic.id,
        name: clinic.name,
        weeklyHours: JSON.parse(JSON.stringify(clinic.weeklyHours)),
        themeColor: clinic.themeColor,
        address: clinic.address || '',
        phone: clinic.phone || '',
        lineUrl: clinic.lineUrl || '',
        scheduleImageUrl: clinic.scheduleImageUrl || '',
        logoUrl: clinic.logoUrl || '',
        shiftColors: clinic.shiftColors || {
            morning: '#fbbf24',
            afternoon: '#fb923c',
            evening: '#818cf8'
        },
        styleConfig: config,
        googleCalendarMapping: clinic.googleCalendarMapping || {},
        allowedUsers: clinic.allowedUsers || []
    });
    setStyleJson(JSON.stringify(config, null, 2));
    setEmailInput('');
    setEditingId(clinic.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJsonChange = (val: string) => {
    setStyleJson(val);
    try {
        const parsed = JSON.parse(val);
        updateClinicFromStyle(parsed);
        setJsonError(null);
    } catch (e) {
        setJsonError("Invalid JSON format");
    }
  };

  const handleVisualConfigChange = (newConfig: ClinicStyleConfig) => {
    setStyleJson(JSON.stringify(newConfig, null, 2));
    updateClinicFromStyle(newConfig);
  };

  const updateClinicFromStyle = (parsed: ClinicStyleConfig) => {
        const updates: Partial<Clinic> = { styleConfig: parsed };
        
        let colorsChanged = false;
        const currentColors = newClinic.shiftColors || { morning: '#fbbf24', afternoon: '#fb923c', evening: '#818cf8' };
        const newColors = { ...currentColors };

        if (parsed.palette?.accentColor && typeof parsed.palette.accentColor === 'string') {
            updates.themeColor = parsed.palette.accentColor;
        }

        const styles = parsed.shifts?.styles || parsed.palette?.shifts?.styles;
        if (styles) {
            const getCol = (s: any) => s?.bg || s?.color;
            const m = getCol(styles.morning);
            if (m && typeof m === 'string') { newColors.morning = m; colorsChanged = true; }
            const a = getCol(styles.afternoon);
            if (a && typeof a === 'string') { newColors.afternoon = a; colorsChanged = true; }
            const e = getCol(styles.evening);
            if (e && typeof e === 'string') { newColors.evening = e; colorsChanged = true; }
        }

        if (colorsChanged) {
            updates.shiftColors = newColors;
        }

        setNewClinic(prev => ({ ...prev, ...updates }));
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
         if (!confirm("圖片較大 (>5MB)，上傳可能需要一點時間。確定要繼續嗎？")) return;
      }
      
      setIsUploading(true);
      try {
        const dimensions = await new Promise<{width: number, height: number}>((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
                URL.revokeObjectURL(objectUrl);
            };
            img.onerror = reject;
            img.src = objectUrl;
        });

        let clinicId = newClinic.id;
        if (!clinicId) {
            clinicId = generateId();
            setNewClinic(prev => ({ ...prev, id: clinicId }));
        }

        const path = `clinics/${clinicId}/backgrounds`;
        const downloadUrl = await uploadImage(file, path);
        
        setNewClinic(prev => {
            const currentStyle = prev.styleConfig || DEFAULT_STYLE_CONFIG;
            const currentCanvasLayout = currentStyle.canvas_layout || { 
                container_width: 1080, 
                container_height: 1350, 
                grid_area: { x: 50, y: 300, width: 980, height: 800 } 
            };

            const newStyle = {
                ...currentStyle,
                canvas_layout: {
                    ...currentCanvasLayout,
                    base_image_width: dimensions.width,
                    base_image_height: dimensions.height,
                    base_image_filename: file.name
                }
            };
            
            setStyleJson(JSON.stringify(newStyle, null, 2));

            return { 
                ...prev, 
                scheduleImageUrl: downloadUrl,
                styleConfig: newStyle
            };
        });

      } catch (error: any) {
        console.error("Upload/Read failed", error);
        alert(`圖片上傳失敗: ${error.message || '未知錯誤'}\n請檢查 Firebase Storage 權限設定。`);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleSaveClinic = async () => {
    if (!newClinic.name) return;
    if (jsonError) {
        alert("請修正 Style Config JSON 格式錯誤");
        return;
    }
    
    setIsSaving(true);
    try {
        const safeWeeklyHours = newClinic.weeklyHours ? JSON.parse(JSON.stringify(newClinic.weeklyHours)) : Array(7).fill({ Morning: true, Afternoon: true, Evening: true });
        const safeShiftColors = newClinic.shiftColors || { morning: '#fbbf24', afternoon: '#fb923c', evening: '#818cf8' };
        const safeStyleConfig = newClinic.styleConfig || DEFAULT_STYLE_CONFIG;
        const safeAllowedUsers = newClinic.allowedUsers || [];

        let updatedClinics: Clinic[];

        if (editingId) {
            updatedClinics = clinics.map(c => c.id === editingId ? {
                ...c,
                name: newClinic.name!,
                weeklyHours: safeWeeklyHours,
                themeColor: newClinic.themeColor || '#0d9488',
                address: newClinic.address || '',
                phone: newClinic.phone || '',
                lineUrl: newClinic.lineUrl || '',
                scheduleImageUrl: newClinic.scheduleImageUrl || '',
                logoUrl: newClinic.logoUrl || '',
                shiftColors: safeShiftColors,
                styleConfig: safeStyleConfig,
                googleCalendarMapping: newClinic.googleCalendarMapping || c.googleCalendarMapping || {},
                allowedUsers: safeAllowedUsers
            } : c);
        } else {
            const clinic: Clinic = {
                id: newClinic.id || generateId(),
                name: newClinic.name!,
                weeklyHours: safeWeeklyHours,
                themeColor: newClinic.themeColor || '#0d9488',
                address: newClinic.address || '',
                phone: newClinic.phone || '',
                lineUrl: newClinic.lineUrl || '',
                scheduleImageUrl: newClinic.scheduleImageUrl || '',
                logoUrl: newClinic.logoUrl || '',
                shiftColors: safeShiftColors,
                styleConfig: safeStyleConfig,
                googleCalendarMapping: {},
                allowedUsers: safeAllowedUsers
            };
            updatedClinics = [...clinics, clinic];
        }

        // Call parent save handler
        await onSave(updatedClinics);
        closeForm();
        
    } catch (e) {
        console.error("Save Clinic Error", e);
        alert("儲存失敗: " + (e as Error).message);
    } finally {
        setIsSaving(false);
    }
  };

  const toggleShift = (dayIdx: number, shift: keyof DailyHours) => {
    if (!newClinic.weeklyHours) return;
    const updatedHours = [...newClinic.weeklyHours];
    updatedHours[dayIdx] = {
        ...updatedHours[dayIdx],
        [shift]: !updatedHours[dayIdx][shift]
    };
    setNewClinic({ ...newClinic, weeklyHours: updatedHours });
  };

  const toggleDayStatus = (dayIdx: number) => {
      if (!newClinic.weeklyHours) return;
      
      const current = newClinic.weeklyHours[dayIdx];
      const isClosed = !current.Morning && !current.Afternoon && !current.Evening;
      
      const updatedHours = [...newClinic.weeklyHours];
      if (isClosed) {
          updatedHours[dayIdx] = { Morning: true, Afternoon: true, Evening: true };
      } else {
          updatedHours[dayIdx] = { Morning: false, Afternoon: false, Evening: false };
      }
      setNewClinic({ ...newClinic, weeklyHours: updatedHours });
  };

  const handleAddEmail = () => {
      const email = emailInput.trim();
      if (!email || !email.includes('@')) return; 
      
      const currentList = newClinic.allowedUsers || [];
      if (currentList.includes(email)) {
          setEmailInput('');
          return;
      }
      
      setNewClinic({ ...newClinic, allowedUsers: [...currentList, email] });
      setEmailInput('');
  };

  const handleRemoveEmail = (email: string) => {
      const currentList = newClinic.allowedUsers || [];
      setNewClinic({ ...newClinic, allowedUsers: currentList.filter(e => e !== email) });
  };

  const renderStatus = (hours: DailyHours) => {
      if (!hours.Morning && !hours.Afternoon && !hours.Evening) return <span className="text-rose-500 font-medium">全日休診</span>;
      if (hours.Morning && hours.Afternoon && hours.Evening) return <span className="text-emerald-500 font-medium">全日看診</span>;
      
      const parts = [];
      if (hours.Morning) parts.push('早');
      if (hours.Afternoon) parts.push('午');
      if (hours.Evening) parts.push('晚');
      return <span className="text-slate-600">{parts.join('/')}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h2 className="text-3xl font-bold text-slate-800">診所管理</h2>
            <p className="text-slate-500">設定診所地點及其固定營業時間。</p>
        </div>
        {!isAdding && userRole === 'admin' && (
            <button
            onClick={initNewClinic}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
            <Plus size={18} /> 新增診所
            </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in">
          <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-700">{editingId ? '編輯診所' : '新增診所'}</h3>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600"><X /></button>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Basic Info */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">診所名稱</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                  value={newClinic.name || ''}
                  onChange={e => setNewClinic({ ...newClinic, name: e.target.value })}
                  placeholder="例如：台北總院"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">地址</label>
                    <input
                        type="text"
                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                        value={newClinic.address || ''}
                        onChange={e => setNewClinic({ ...newClinic, address: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">電話</label>
                    <input
                        type="text"
                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                        value={newClinic.phone || ''}
                        onChange={e => setNewClinic({ ...newClinic, phone: e.target.value })}
                    />
                </div>
              </div>
              
              <div>
                   <label className="block text-sm font-medium text-slate-700 mb-1">Line@ 約診連結</label>
                   <input
                       type="text"
                       className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-teal-500 outline-none"
                       value={newClinic.lineUrl || ''}
                       onChange={e => setNewClinic({ ...newClinic, lineUrl: e.target.value })}
                       placeholder="https://line.me/..."
                   />
              </div>

              {/* Authorized Staff Section */}
              <div className="border-t border-slate-100 pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                      <Users size={16} /> 授權人員 (Authorized Staff)
                  </h4>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div className="flex gap-2 mb-3">
                          <input
                              type="email"
                              className="flex-1 border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                              placeholder="輸入 Email (例如: staff@example.com)"
                              value={emailInput}
                              onChange={e => setEmailInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddEmail())}
                          />
                          <button
                              onClick={handleAddEmail}
                              type="button"
                              className="bg-white border border-slate-300 hover:bg-teal-50 hover:text-teal-600 hover:border-teal-300 text-slate-600 px-4 py-1.5 rounded-md text-sm font-bold transition-colors"
                          >
                              新增
                          </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {(newClinic.allowedUsers || []).map(email => (
                              <span key={email} className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 shadow-sm">
                                  {email}
                                  <button 
                                    onClick={() => handleRemoveEmail(email)} 
                                    className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full p-0.5 transition-colors"
                                  >
                                      <X size={12}/>
                                  </button>
                              </span>
                          ))}
                          {(newClinic.allowedUsers || []).length === 0 && (
                              <p className="text-xs text-slate-400 italic">尚未設定授權人員。預設僅全域管理員可存取。</p>
                          )}
                      </div>
                  </div>
              </div>

              <div className="border-t border-slate-100 pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                      <Palette size={16} /> 視覺與樣式設定
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">排班表底圖 (Background Image)</label>
                            <div className="flex items-start gap-4">
                                {newClinic.scheduleImageUrl ? (
                                    <div className="flex flex-col gap-2">
                                        <div className="relative w-32 h-32 border rounded-lg bg-slate-50 flex items-center justify-center group shrink-0 overflow-hidden">
                                            <img src={newClinic.scheduleImageUrl} alt="Background Preview" className="w-full h-full object-cover" />
                                            <button 
                                                onClick={() => setNewClinic({ ...newClinic, scheduleImageUrl: '' })}
                                                className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                        {newClinic.styleConfig?.canvas_layout?.base_image_filename && (
                                            <div className="text-[10px] text-slate-500 font-mono leading-tight">
                                                <div className="truncate w-32 font-medium" title={newClinic.styleConfig.canvas_layout.base_image_filename}>
                                                    {newClinic.styleConfig.canvas_layout.base_image_filename}
                                                </div>
                                                <div className="text-slate-400">
                                                    {newClinic.styleConfig.canvas_layout.base_image_width} x {newClinic.styleConfig.canvas_layout.base_image_height} px
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="w-32 h-32 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 bg-slate-50 shrink-0">
                                        {isUploading ? <Loader2 className="animate-spin text-teal-600"/> : <span className="text-xs">無底圖</span>}
                                    </div>
                                )}
                                <div className="flex-1">
                                    <label className={`
                                        flex items-center justify-center w-full px-4 py-2 border border-slate-300 rounded-lg shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer
                                        ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}>
                                        {isUploading ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin mr-2" /> 上傳中...
                                            </>
                                        ) : (
                                            <>
                                                <Upload size={16} className="mr-2" /> 上傳圖片 (Cloud)
                                            </>
                                        )}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleBackgroundUpload}
                                            disabled={isUploading}
                                            className="hidden"
                                        />
                                    </label>
                                    <p className="text-xs text-slate-500 mt-2">
                                        支援 JPG, PNG。系統將自動讀取圖片尺寸並更新設定。
                                    </p>
                                </div>
                            </div>
                        </div>
                  </div>

                  {/* Visual Config Form */}
                  <div className="mt-4">
                    <VisualConfigForm 
                        config={newClinic.styleConfig || DEFAULT_STYLE_CONFIG}
                        onChange={handleVisualConfigChange}
                    />

                    {/* Raw JSON Editor Toggle */}
                    <div className="mt-2 text-right">
                        <button 
                            onClick={() => setShowJsonEditor(!showJsonEditor)}
                            className="text-xs flex items-center gap-1 text-slate-400 hover:text-slate-600 ml-auto"
                        >
                            <Code size={12} /> {showJsonEditor ? '隱藏原始碼' : '顯示原始碼 (Raw JSON)'}
                        </button>
                    </div>

                    {showJsonEditor && (
                        <div className="mt-2 animate-fade-in">
                            <textarea
                                className={`w-full h-40 font-mono text-[10px] border rounded p-2 focus:ring-2 outline-none ${jsonError ? 'border-rose-300 ring-rose-200' : 'border-slate-300 focus:ring-teal-200'}`}
                                value={styleJson}
                                onChange={e => handleJsonChange(e.target.value)}
                            />
                            {jsonError && <p className="text-xs text-rose-500 mt-1">{jsonError}</p>}
                        </div>
                    )}
                  </div>
              </div>
            </div>
            
            {/* Right: Weekly Schedule */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">每週固定看診時間</label>
              <div className="border rounded-lg overflow-hidden text-sm">
                  <div className="grid grid-cols-5 bg-slate-50 border-b p-2 font-medium text-slate-500">
                      <div className="col-span-1">星期</div>
                      <div className="text-center">早診</div>
                      <div className="text-center">午診</div>
                      <div className="text-center">晚診</div>
                      <div className="text-center text-xs">狀態切換</div>
                  </div>
                  {DAYS.map((day, idx) => {
                      const hours = newClinic.weeklyHours?.[idx] || { Morning: false, Afternoon: false, Evening: false };
                      const isClosed = !hours.Morning && !hours.Afternoon && !hours.Evening;

                      return (
                        <div key={day} className="grid grid-cols-5 items-center p-2 border-b last:border-0 hover:bg-slate-50 transition-colors">
                            <div className="font-medium text-slate-700">{day}</div>
                            <div className="flex justify-center">
                                <button 
                                    onClick={() => toggleShift(idx, 'Morning')}
                                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${hours.Morning ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-300'}`}
                                >
                                    {hours.Morning ? <Check size={14}/> : <X size={14}/>}
                                </button>
                            </div>
                            <div className="flex justify-center">
                                <button 
                                    onClick={() => toggleShift(idx, 'Afternoon')}
                                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${hours.Afternoon ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-300'}`}
                                >
                                    {hours.Afternoon ? <Check size={14}/> : <X size={14}/>}
                                </button>
                            </div>
                            <div className="flex justify-center">
                                <button 
                                    onClick={() => toggleShift(idx, 'Evening')}
                                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${hours.Evening ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-300'}`}
                                >
                                    {hours.Evening ? <Check size={14}/> : <X size={14}/>}
                                </button>
                            </div>
                            <div className="flex justify-center">
                                <button 
                                    onClick={() => toggleDayStatus(idx)} 
                                    className={`text-xs font-medium hover:underline px-2 py-1 rounded transition-colors ${isClosed ? 'text-teal-600 bg-teal-50' : 'text-rose-500 hover:bg-rose-50'}`}
                                >
                                    {isClosed ? '開診' : '休診'}
                                </button>
                            </div>
                        </div>
                      );
                  })}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
                onClick={closeForm}
                disabled={isSaving}
                className="px-6 py-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
                取消
            </button>
            <button
              onClick={handleSaveClinic}
              disabled={!newClinic.name || !!jsonError || isUploading || isSaving}
              className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[120px] justify-center"
            >
              {isSaving ? (
                 <>
                    <Loader2 size={16} className="animate-spin" /> 儲存中...
                 </>
              ) : isUploading ? (
                 <Loader2 size={16} className="animate-spin" /> 
              ) : (
                editingId ? '更新診所' : '儲存診所'
              )}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {(clinics || []).map(clinic => (
          <div key={clinic.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group relative">
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button 
                    onClick={() => handleEdit(clinic)}
                    className="p-2 bg-white rounded-full shadow-sm text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                >
                    <Edit2 size={16} />
                </button>
            </div>

            <div className="h-2 w-full" style={{ backgroundColor: clinic.themeColor }}></div>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                  {clinic.logoUrl && (
                      <img src={clinic.logoUrl} alt="logo" className="w-12 h-12 object-contain rounded-md border border-slate-100 p-1" />
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{clinic.name}</h3>
                  </div>
              </div>
              
              <div className="mt-2 space-y-2">
                {clinic.address && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin size={16} className="text-slate-400" />
                        <span>{clinic.address}</span>
                    </div>
                )}
                {clinic.phone && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone size={16} className="text-slate-400" />
                        <span>{clinic.phone}</span>
                    </div>
                )}
                {clinic.lineUrl && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <LinkIcon size={16} className="text-slate-400" />
                        <a href={clinic.lineUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]">
                            {clinic.lineUrl}
                        </a>
                    </div>
                )}
                {clinic.scheduleImageUrl && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <ImageIcon size={16} className="text-slate-400" />
                        <span className="text-xs text-slate-400 truncate max-w-[200px]">背景圖已設定</span>
                    </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">營業時間</span>
                    <div className="flex gap-1">
                        <div className="w-3 h-3 rounded-full" title="早診" style={{backgroundColor: clinic.shiftColors?.morning || '#fbbf24'}}></div>
                        <div className="w-3 h-3 rounded-full" title="午診" style={{backgroundColor: clinic.shiftColors?.afternoon || '#fb923c'}}></div>
                        <div className="w-3 h-3 rounded-full" title="晚診" style={{backgroundColor: clinic.shiftColors?.evening || '#818cf8'}}></div>
                    </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-y-1 text-xs">
                    {(clinic.weeklyHours || []).map((hours, idx) => (
                        <React.Fragment key={idx}>
                            <div className="font-semibold text-slate-500">{DAYS[idx]}</div>
                            <div className="col-span-3 text-right">
                                {renderStatus(hours)}
                            </div>
                        </React.Fragment>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ))}
        {(!clinics || clinics.length === 0) && !isAdding && (
            <div className="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
                <p className="text-slate-500">尚未新增診所，請點擊上方按鈕新增。</p>
            </div>
        )}
      </div>
    </div>
  );
};
