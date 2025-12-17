
import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';

export const VersionChecker: React.FC = () => {
    const [currentVersion, setCurrentVersion] = useState<string | null>(null);
    const [hasUpdate, setHasUpdate] = useState(false);

    useEffect(() => {
        const checkVersion = async (isInitial = false) => {
            try {
                // Add timestamp to query to prevent browser caching of the JSON file
                const response = await fetch(`/version.json?t=${Date.now()}`);
                if (!response.ok) return;
                
                const data = await response.json();
                const fetchedVersion = data.version;

                if (isInitial) {
                    setCurrentVersion(fetchedVersion);
                    console.log(`[VersionChecker] Current App Version: ${fetchedVersion}`);
                } else if (currentVersion && fetchedVersion !== currentVersion) {
                    console.log(`[VersionChecker] New Version Detected: ${fetchedVersion} (Old: ${currentVersion})`);
                    setHasUpdate(true);
                }
            } catch (error) {
                console.error("[VersionChecker] Failed to check version", error);
            }
        };

        // 1. Initial Check on Mount
        checkVersion(true);

        // 2. Poll every 5 minutes (300,000 ms)
        const intervalId = setInterval(() => {
            checkVersion(false);
        }, 5 * 60 * 1000);

        return () => clearInterval(intervalId);
    }, [currentVersion]);

    const handleReload = () => {
        window.location.reload();
    };

    if (!hasUpdate) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] animate-slide-up">
            <div className="bg-slate-900 text-white p-4 rounded-xl shadow-2xl flex items-center gap-5 border border-slate-700 ring-2 ring-white/20">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-500/20 rounded-full text-teal-400">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-base text-white">系統有新版本</h4>
                        <p className="text-xs text-slate-400">New version available</p>
                    </div>
                </div>
                <button
                    onClick={handleReload}
                    className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-teal-900/50"
                >
                    <RefreshCw size={16} /> 立即更新
                </button>
            </div>
        </div>
    );
};
