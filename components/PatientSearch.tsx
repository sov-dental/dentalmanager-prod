
import React, { useState } from 'react';
import { Doctor } from '../types';
import { searchEvents, GoogleEvent } from '../services/googleCalendar';
import { Search, Calendar, User, Loader2, Clock } from 'lucide-react';

interface Props {
  doctors: Doctor[];
  mapping: Record<string, string>;
  onEventClick: (event: any) => void;
}

export const PatientSearch: React.FC<Props> = ({ doctors, mapping, onEventClick }) => {
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(doctors[0]?.id || '');
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState(() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().split('T')[0];
  });
  
  const [results, setResults] = useState<GoogleEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedDoctorId || !query) return;
      
      const calendarId = mapping[selectedDoctorId];
      if (!calendarId) {
          alert('此醫師尚未綁定 Google 日曆');
          return;
      }

      setIsLoading(true);
      setHasSearched(true);
      setResults([]);

      try {
          const start = new Date(startDate);
          const end = new Date(endDate);
          // Set proper time boundaries
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);

          const events = await searchEvents(calendarId, query, start, end);
          setResults(events);
      } catch (err) {
          console.error(err);
          alert('搜尋失敗，請檢查網路或日期範圍');
      } finally {
          setIsLoading(false);
      }
  };

  const handleClick = (googleEvent: GoogleEvent) => {
      // Map GoogleEvent to the shape expected by AppointmentDetailModal
      const start = googleEvent.start.dateTime ? new Date(googleEvent.start.dateTime) : (googleEvent.start.date ? new Date(googleEvent.start.date) : new Date());
      const calendarId = mapping[selectedDoctorId];
      
      onEventClick({
          id: googleEvent.id,
          title: googleEvent.summary,
          start: start,
          doctorId: selectedDoctorId,
          calendarId: calendarId,
          allDay: googleEvent.allDay
      });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50 p-6">
        {/* Search Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Search size={20} className="text-teal-600"/> 病歷搜尋
            </h3>
            <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                {/* Doctor Selection: 3 Cols */}
                <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">選擇醫師</label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <select 
                            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-teal-500"
                            value={selectedDoctorId}
                            onChange={e => setSelectedDoctorId(e.target.value)}
                        >
                            <option value="" disabled>請選擇醫師</option>
                            {doctors.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Keyword: 3 Cols */}
                <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">搜尋關鍵字 (病患姓名)</label>
                    <input 
                        type="text"
                        className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        placeholder="輸入姓名..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                </div>

                {/* Start Date: 2 Cols */}
                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">開始日期</label>
                    <input 
                        type="date"
                        className="w-full border rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                    />
                </div>

                {/* End Date: 2 Cols */}
                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">結束日期</label>
                    <input 
                        type="date"
                        className="w-full border rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                    />
                </div>

                {/* Button: 2 Cols (Fills remaining) */}
                <button 
                    type="submit"
                    disabled={isLoading || !selectedDoctorId || !query}
                    className="md:col-span-2 w-full bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                    {isLoading ? <Loader2 size={18} className="animate-spin"/> : <Search size={18} />}
                    搜尋
                </button>
            </form>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-200 p-0 relative">
            <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-6 py-3 font-bold text-slate-500 text-xs uppercase flex justify-between">
                <span>搜尋結果 ({results.length})</span>
                {hasSearched && <span>區間: {startDate} ~ {endDate}</span>}
            </div>
            
            {results.length > 0 ? (
                <div className="divide-y divide-slate-100">
                    {results.map(ev => {
                        const start = ev.start.dateTime ? new Date(ev.start.dateTime) : (ev.start.date ? new Date(ev.start.date) : new Date());
                        const isPast = start < new Date();
                        
                        return (
                            <div 
                                key={ev.id} 
                                onClick={() => handleClick(ev)}
                                className="p-4 hover:bg-teal-50 cursor-pointer transition-colors group flex items-center justify-between"
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border ${isPast ? 'bg-slate-50 border-slate-200' : 'bg-white border-teal-200'}`}>
                                        <span className="text-xs text-slate-500 font-bold uppercase">{start.toLocaleString('en-US', { month: 'short' })}</span>
                                        <span className="text-2xl font-bold text-slate-800">{start.getDate()}</span>
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-lg group-hover:text-teal-700 transition-colors">{ev.summary}</h4>
                                        <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                                            <span className="flex items-center gap-1">
                                                <Clock size={14} /> 
                                                {ev.allDay ? '全日' : start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </span>
                                            {isPast && <span className="px-2 py-0.5 bg-slate-100 rounded text-xs">已結束</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-slate-300 group-hover:text-teal-500">
                                    <Calendar size={20} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                    {hasSearched ? (
                        <>
                            <Search size={48} className="mb-4 text-slate-200" />
                            <p>找不到符合的約診紀錄</p>
                        </>
                    ) : (
                        <>
                            <Calendar size={48} className="mb-4 text-slate-200" />
                            <p>請輸入條件開始搜尋</p>
                        </>
                    )}
                </div>
            )}
        </div>
    </div>
  );
};
