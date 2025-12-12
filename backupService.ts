
import { db, loadAppData } from './services/firebase';

export const performFullBackup = async () => {
    try {
        console.log("Starting Full Backup...");
        
        // 1. Fetch Main App Data (Clinics, Doctors, etc.)
        const appData = await loadAppData();
        
        // 2. Fetch All Daily Accounting Records
        // Note: For a production app with thousands of records, we might want to range-limit this.
        // For now, we dump the entire collection as requested.
        const accSnapshot = await db.collection('daily_accounting').get();
        const accountingRecords = accSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // 3. Bundle Data
        const backupBundle = {
            timestamp: new Date().toISOString(),
            version: '1.0',
            appData,
            dailyAccounting: accountingRecords
        };

        // 4. Trigger Download
        const blob = new Blob([JSON.stringify(backupBundle, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dental_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        return true;
    } catch (error) {
        console.error("Backup failed", error);
        throw error;
    }
};
