
import React from 'react';
import { Clinic, Doctor, DailySchedule, ShiftType, ClinicStyleConfig } from '../types';

export const SHIFTS: ShiftType[] = ['Morning', 'Afternoon', 'Evening'];
export const WEEKDAYS = ['Sun (日)', 'Mon (一)', 'Tue (二)', 'Wed (三)', 'Thu (四)', 'Fri (五)', 'Sat (六)'];

export interface ScheduleRendererProps {
    clinic: Clinic;
    config: ClinicStyleConfig;
    layoutData: any;
    titleData: any;
    containerWidth: number;
    containerHeight: number;
    year: number;
    month: number;
    monthSchedules: DailySchedule[];
    calendarCells: (number | null)[];
    doctors: Doctor[];
}

export const ScheduleRenderer: React.FC<ScheduleRendererProps> = ({ 
    clinic, config, layoutData, titleData, containerWidth, containerHeight, year, month, monthSchedules, calendarCells, doctors 
}) => {
    const palette = config.palette;
    const layout = config.layout;
    const typography = config.typography;
    const shiftDisplay = config.shifts || { displayMode: 'bar', showTime: true };
    const spacing = config.spacing || {};
    const corrections = config.corrections || {};

    const titleFont = typography.titleFont || typography.fontFamily || '"M PLUS Rounded 1c", sans-serif';
    const bodyFont = typography.bodyFont || typography.fontFamily || '"Noto Sans TC", sans-serif';

    const shiftColors = {
        Morning: clinic.shiftColors?.morning || '#fbbf24',
        Afternoon: clinic.shiftColors?.afternoon || '#fb923c',
        Evening: clinic.shiftColors?.evening || '#818cf8',
    };

    const shiftLabels = clinic.shiftLabels || {
        morning: '早診 10:00-13:00',
        afternoon: '午診 14:00-17:00',
        evening: '晚診 18:00-21:00'
    };

    const hasImage = !!clinic.scheduleImageUrl;
    const shouldShowTitle = layoutData ? (config.canvasLayout?.titleArea?.show ?? false) : !hasImage;

    // Determine Header Border Radius
    const headerCornerStyle = config.layout?.headerCornerStyle || 'rounded-top';
    let headerRadius = '16px 16px 0 0';
    if (headerCornerStyle === 'rounded-all') headerRadius = '16px';
    if (headerCornerStyle === 'squared') headerRadius = '0px';

    const gridWrapperStyle = hasImage ? {
        backgroundColor: palette.gridBackground || 'transparent',
        gap: 0,
        // Removed borderTop to prevent double borders with the Header's bottom border
        borderLeft: `1px dashed ${palette.gridBorder}`,
        fontFamily: bodyFont,
    } : {
        backgroundColor: palette.gridBorder,
        gap: layout.gridGap,
        borderTop: 'none',
        borderLeft: 'none',
        fontFamily: bodyFont,
    };

    const getCellBg = (isClosed: boolean) => {
        if (hasImage) return 'transparent';
        return isClosed ? (palette.closedDayBackground || '#f8fafc') : palette.background;
    };

    const getCellBorder = () => {
        if (hasImage) return `1px dashed ${palette.gridBorder}`;
        return 'none';
    };

    const getDateColor = (isSunday: boolean, isSaturday: boolean) => {
        const dt = palette.dateText;
        if (isSunday) return dt?.sunday || palette.weekend.sunday;
        if (isSaturday) return dt?.saturday || palette.weekend.saturday;
        return dt?.weekday || palette.text;
    };

    const renderCellContent = (schedule: DailySchedule | undefined, isClosed: boolean | undefined, isSunday: boolean) => {
        // Logic Update: Check for shifts FIRST (Priority 1)
        const hasShifts = schedule && SHIFTS.some(shift => (schedule.shifts[shift] || []).length > 0);

        // If NO shifts are present, check for Closed/Sunday status (Priority 2)
        if (!hasShifts && (isSunday || isClosed)) {
            const closedColor = isSunday ? palette.weekend.sunday : (palette.weekend.sunday || '#f43f5e');
            return (
                <div className="flex-1 w-full flex items-center justify-center">
                    <span 
                        className="font-bold text-3xl tracking-widest leading-none select-none"
                        style={{ color: closedColor }}
                    >
                        休診
                    </span>
                </div>
            );
        }

        if (!schedule) return null;

        const doctorMap = new Map<string, Set<ShiftType>>();
        SHIFTS.forEach(shift => {
            const docIds = schedule.shifts[shift];
            docIds.forEach(id => {
                if (!doctorMap.has(id)) doctorMap.set(id, new Set());
                doctorMap.get(id)?.add(shift);
            });
        });

        const commonText = { 
            fontSize: `calc(${typography.bodySize} * 0.9)`, 
            lineHeight: 1, 
            fontWeight: 700, 
            color: palette.text,
            transform: corrections.doctorNameY ? `translateY(${corrections.doctorNameY})` : undefined
        };

        const dotStyle: React.CSSProperties = {
            width: '16px',
            height: '16px',
            color: '#ffffff',
            fontSize: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            lineHeight: 1,
            fontWeight: 500,
        };

        return (
            <div 
                className="flex flex-col items-start w-full px-1"
                style={{
                    marginTop: spacing.doctorListTopMargin || '4px',
                    gap: spacing.doctorRowGap || '2px'
                }}
            >
                {Array.from(doctorMap.entries()).map(([docId, shifts]) => {
                    const doc = doctors.find(d => d.id === docId);
                    if (!doc) return null;

                    return (
                        <div key={docId} className="flex items-center gap-1 w-full">
                            <div 
                                className="flex items-center justify-end gap-0.5 shrink-0" 
                                style={{ 
                                    width: '54px',
                                    transform: corrections.dotContainerY ? `translateY(${corrections.dotContainerY})` : undefined
                                }}
                            >
                                {SHIFTS.map(shift => (
                                    shifts.has(shift) && (
                                        <div 
                                            key={shift}
                                            style={{ 
                                                ...dotStyle,
                                                backgroundColor: shiftColors[shift] 
                                            }} 
                                        >
                                            <span style={{ 
                                                display: 'block',
                                                transform: corrections.dotTextY ? `translateY(${corrections.dotTextY})` : undefined
                                            }}>
                                                {shift === 'Morning' ? '早' : shift === 'Afternoon' ? '午' : '晚'}
                                            </span>
                                        </div>
                                    )
                                ))}
                            </div>
                            <span className="whitespace-nowrap flex-shrink-0" style={commonText}>{doc.name}</span>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div 
            style={{
                width: '100%',
                height: '100%',
                backgroundColor: hasImage ? 'transparent' : palette.background,
                position: 'relative'
            }}
        >
            {/* LAYER 1: Background Image */}
            {clinic.scheduleImageUrl && (
                <img 
                    src={clinic.scheduleImageUrl}
                    crossOrigin="anonymous"
                    alt="Background"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        zIndex: 0
                    }}
                />
            )}

            {/* LAYER 2: Content */}
            {layoutData ? (
                // --- CANVAS LAYOUT MODE (Absolute Positioning) ---
                <>
                    {titleData && (
                        <div
                            style={{
                                position: 'absolute',
                                left: `${titleData.x}px`,
                                top: `${titleData.y}px`,
                                fontSize: titleData.font_size ? `${titleData.font_size}px` : '48px',
                                color: titleData.color || '#000000',
                                fontWeight: titleData.font_weight || 'bold',
                                zIndex: 20,
                                transform: titleData.align === 'center' ? 'translateX(-50%)' : 'none',
                                whiteSpace: 'nowrap',
                                lineHeight: 1,
                                fontFamily: titleFont,
                            }}
                        >
                            {(() => {
                                const titleTemplate = titleData.text || '{month}月';
                                return titleTemplate.replace('{month}', String(month + 1));
                            })()}
                        </div>
                    )}

                    <div
                        className="absolute z-10 flex flex-col"
                        style={{
                            left: `${layoutData.x}px`,
                            top: `${layoutData.y}px`,
                            width: `${layoutData.width}px`,
                            height: `${layoutData.height}px`,
                        }}
                    >
                        {/* Optional Title in Canvas Mode (Legacy) */}
                        {shouldShowTitle && config.canvasLayout?.titleArea && !titleData && (
                            <div style={{
                                position: 'absolute',
                                left: config.canvasLayout.titleArea.x ? `${config.canvasLayout.titleArea.x - layoutData.x}px` : 0,
                                top: config.canvasLayout.titleArea.y ? `${config.canvasLayout.titleArea.y - layoutData.y}px` : -50,
                            }}>
                                <h1 
                                    className="text-4xl tracking-tight leading-none mb-1" 
                                    style={{ 
                                        color: clinic.themeColor, 
                                        fontWeight: typography.headerWeight,
                                        fontFamily: titleFont,
                                    }}
                                >
                                    {clinic.name}
                                </h1>
                            </div>
                        )}

                        {/* Grid Header */}
                        <div 
                            className="flex w-full shrink-0"
                            style={{ 
                                backgroundColor: palette.gridHeaderBg,
                                color: palette.gridHeaderText,
                                height: '50px',
                                borderRadius: headerRadius,
                                fontFamily: bodyFont,
                                // Apply border bottom to separate from grid
                                borderBottom: hasImage ? `1px dashed ${palette.gridBorder}` : 'none'
                            }}
                        >
                            {WEEKDAYS.map((d) => (
                                <div 
                                    key={d} 
                                    className="flex-1 flex items-center justify-center font-bold leading-none"
                                    style={{ 
                                        fontSize: typography.gridHeaderSize || '28px',
                                        transform: corrections.headerTextY ? `translateY(${corrections.headerTextY})` : undefined,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                        
                        {/* Grid Body */}
                        <div 
                            className="flex-1 grid grid-cols-7 auto-rows-fr" 
                            style={{ 
                                ...gridWrapperStyle,
                            }}
                        >
                            {calendarCells.map((dayNum, i) => {
                                // Fix: Render empty cells with borders to maintain grid structure
                                if(dayNum === null) {
                                    return (
                                        <div 
                                            key={`empty-${i}`} 
                                            className="flex flex-col relative justify-start items-start w-full h-full"
                                            style={{
                                                backgroundColor: hasImage ? 'transparent' : palette.background,
                                                opacity: hasImage ? 1 : 0.5,
                                                borderRight: getCellBorder(),
                                                borderBottom: getCellBorder(),
                                            }}
                                        />
                                    );
                                }
                                
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                                const schedule = monthSchedules.find(s => s.date === dateStr);
                                const isClosed = schedule?.isClosed;
                                
                                const isSunday = (i % 7) === 0;
                                const isSaturday = (i % 7) === 6;
                                const dateColor = getDateColor(isSunday, isSaturday);
                                
                                return (
                                    <div 
                                        key={dayNum} 
                                        className="flex flex-col relative justify-start items-start w-full h-full"
                                        style={{ 
                                            backgroundColor: getCellBg(!!isClosed),
                                            padding: layout.cellPadding,
                                            borderRight: getCellBorder(),
                                            borderBottom: getCellBorder(),
                                        }}
                                    >
                                        <span 
                                            className="leading-none mb-1 font-bold block"
                                            style={{ color: dateColor, fontSize: typography.bodySize }}
                                        >
                                            {dayNum}
                                        </span>
                                        {renderCellContent(schedule, isClosed, isSunday)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            ) : (
                // --- FALLBACK: AUTO LAYOUT MODE (Flex Column) ---
                <div 
                    className="absolute inset-0 z-10 flex flex-col"
                    style={{ 
                        padding: '40px', 
                        fontFamily: bodyFont,
                        color: palette.text,
                        backgroundColor: hasImage ? 'transparent' : palette.background 
                    }}
                >
                    {shouldShowTitle && (
                        <div className={`flex items-center mb-6 px-2 ${layout.headerAlignment === 'space-between' ? 'justify-between' : layout.headerAlignment === 'center' ? 'justify-center flex-col text-center gap-2' : 'justify-start gap-4'}`}>
                            <div className="flex items-center gap-3">
                                {clinic.logoUrl ? (
                                    <img src={clinic.logoUrl} alt="Logo" className="h-24 w-auto object-contain" />
                                ) : (
                                    <div 
                                    className="h-20 w-20 flex items-center justify-center rounded-lg font-bold text-3xl"
                                    style={{ backgroundColor: palette.gridHeaderBg, color: palette.gridHeaderText }}
                                    >
                                        {clinic.name.charAt(0)}
                                    </div>
                                )}
                                <div>
                                    <h1 
                                        className="text-4xl tracking-tight leading-none mb-1" 
                                        style={{ 
                                            color: clinic.themeColor, 
                                            fontWeight: typography.headerWeight,
                                            fontFamily: titleFont
                                        }}
                                    >
                                        {clinic.name}
                                    </h1>
                                    <p className="text-lg font-bold opacity-60 tracking-widest uppercase">門診時刻表</p>
                                </div>
                            </div>
                            <div className={`${layout.headerAlignment === 'center' ? 'flex items-baseline gap-2 mt-2' : 'text-right'}`}>
                                <div className="text-7xl font-black leading-none" style={{color: palette.text, fontFamily: titleFont}}>{month + 1}<span className="text-4xl align-top ml-1">月</span></div>
                                <div className="text-xl font-bold opacity-40 tracking-[0.2em] uppercase">SCHEDULE {year}</div>
                            </div>
                        </div>
                    )}

                    {/* Calendar Grid */}
                    <div 
                        className="flex-1 flex flex-col overflow-hidden"
                        style={{
                            borderColor: palette.gridBorder,
                            borderWidth: layout.borderWidth,
                            borderStyle: layout.borderStyle,
                            borderRadius: layout.cornerRadius,
                        }}
                    >
                        {/* Header */}
                        <div 
                            className="grid grid-cols-7 shrink-0"
                            style={{ backgroundColor: hasImage ? 'transparent' : palette.gridHeaderBg, color: palette.gridHeaderText }}
                        >
                            {WEEKDAYS.map((d) => (
                                <div 
                                    key={d} 
                                    className="py-3 text-center font-bold flex items-center justify-center leading-none"
                                    style={{ 
                                        fontSize: typography.gridHeaderSize || '28px',
                                        transform: corrections.headerTextY ? `translateY(${corrections.headerTextY})` : undefined,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                        
                        {/* Body */}
                        <div 
                            className="grid grid-cols-7 auto-rows-fr h-full" 
                            style={{ 
                                ...gridWrapperStyle
                            }}
                        >
                            {calendarCells.map((dayNum, i) => {
                                if(dayNum === null) return <div key={`empty-${i}`} style={{backgroundColor: hasImage ? 'transparent' : palette.background, opacity: 0.5}}></div>;
                                
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                                const schedule = monthSchedules.find(s => s.date === dateStr);
                                const isClosed = schedule?.isClosed;
                                
                                const isSunday = (i % 7) === 0;
                                const isSaturday = (i % 7) === 6;
                                const dateColor = getDateColor(isSunday, isSaturday);

                                return (
                                    <div 
                                        key={dayNum} 
                                        className="flex flex-col relative justify-start items-start w-full h-full"
                                        style={{ 
                                            backgroundColor: getCellBg(!!isClosed),
                                            padding: layout.cellPadding,
                                            borderRight: getCellBorder(),
                                            borderBottom: getCellBorder(),
                                        }}
                                    >
                                        <span 
                                            className="leading-none mb-1 font-bold block"
                                            style={{ color: dateColor, fontSize: typography.bodySize }}
                                        >
                                            {dayNum}
                                        </span>
                                        {renderCellContent(schedule, isClosed, isSunday)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-4 shrink-0">
                        {shiftDisplay.showTime && (
                            <div className="flex flex-wrap items-center justify-center gap-6 text-sm font-bold opacity-80 mb-4" style={{color: palette.text}}>
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 rounded-full shadow-sm" style={{backgroundColor: shiftColors.Morning}}></span> {shiftLabels.morning}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 rounded-full shadow-sm" style={{backgroundColor: shiftColors.Afternoon}}></span> {shiftLabels.afternoon}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 rounded-full shadow-sm" style={{backgroundColor: shiftColors.Evening}}></span> {shiftLabels.evening}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-end pt-4 border-t-2" style={{borderColor: clinic.themeColor}}>
                            <div className="text-lg font-medium opacity-90" style={{color: palette.text}}>
                                <div>{clinic.address}</div>
                                <div>預約專線：{clinic.phone}</div>
                            </div>
                            {clinic.lineUrl && (
                                <div className="bg-[#06C755] text-white px-5 py-2 rounded-full text-lg font-bold flex items-center gap-2 shadow-sm">
                                    <span>LINE</span> 
                                    <span>預約</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
