// scheduleController.js - Diperluas dengan fungsi automasi
const { supabase } = require('../services/supabaseClient');

// Ambil semua jadwal relay
exports.getScheduleStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('relay_schedules')
            .select('id, relay_id, start_time, end_time, is_active');

        if (error) throw error;

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Tambah atau update jadwal relay
exports.setSchedule = async (req, res) => {
    try {
        const { relay_id, start_time, end_time, is_active } = req.body;

        // Cek apakah sudah ada jadwal untuk relay ini
        const { data: existing, error: checkError } = await supabase
            .from('relay_schedules')
            .select('id')
            .eq('relay_id', relay_id)
            .single();

        let result;
        if (existing) {
            // Update jadwal yang sudah ada
            const { data, error } = await supabase
                .from('relay_schedules')
                .update({
                    start_time,
                    end_time,
                    is_active,
                    updated_at: new Date().toISOString()
                })
                .eq('relay_id', relay_id)
                .select();

            if (error) throw error;
            result = data;
        } else {
            // Buat jadwal baru
            const { data, error } = await supabase
                .from('relay_schedules')
                .insert({
                    relay_id,
                    start_time,
                    end_time,
                    is_active,
                    updated_at: new Date().toISOString()
                })
                .select();

            if (error) throw error;
            result = data;
        }

        res.status(200).json({ 
            message: 'Schedule updated successfully', 
            data: result 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Hapus jadwal
exports.deleteSchedule = async (req, res) => {
    try {
        const { relay_id } = req.params;

        const { error } = await supabase
            .from('relay_schedules')
            .delete()
            .eq('relay_id', relay_id);

        if (error) throw error;

        res.status(200).json({ message: 'Schedule deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Fungsi untuk mengecek dan menjalankan jadwal otomatis
exports.checkAndExecuteSchedules = async () => {
    try {
        console.log('Checking schedules...');
        
        // Ambil semua jadwal yang aktif
        const { data: schedules, error } = await supabase
            .from('relay_schedules')
            .select('*')
            .eq('is_active', true);

        if (error) throw error;

        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 8); // Format HH:MM:SS
        
        console.log(`Current time: ${currentTime}`);

        for (const schedule of schedules) {
            const { relay_id, start_time, end_time } = schedule;
            
            // Cek status relay saat ini
            const { data: relayData, error: relayError } = await supabase
                .from('relays')
                .select('state')
                .eq('relay_id', relay_id)
                .single();

            if (relayError) {
                console.error(`Error getting relay ${relay_id} status:`, relayError);
                continue;
            }

            const currentState = relayData.state;
            const shouldBeOn = isTimeInRange(currentTime, start_time, end_time);

            console.log(`Relay ${relay_id}: Current state: ${currentState}, Should be on: ${shouldBeOn}`);

            // Jika status tidak sesuai dengan jadwal, ubah status
            if (shouldBeOn && !currentState) {
                // Relay harus hidup tapi sedang mati
                await toggleRelayState(relay_id, true);
                console.log(`Relay ${relay_id} turned ON automatically`);
                
                // Kirim notifikasi WhatsApp (opsional untuk start)
                // await sendWhatsAppNotification(`Relay ${relay_id} dihidupkan otomatis pada jam ${currentTime}`);
                
            } else if (!shouldBeOn && currentState) {
                // Relay harus mati tapi sedang hidup
                const toggleSuccess = await toggleRelayState(relay_id, false);
                
                if (toggleSuccess) {
                    console.log(`✅ Relay ${relay_id} turned OFF automatically`);
                    
                    // Kirim notifikasi WhatsApp
                    const notificationMessage = `🔴 NOTIFIKASI AUTOMATIS

Relay Channel ${relay_id} telah dimatikan otomatis karena diluar jam operasional.

⏰ Waktu: ${now.toLocaleString('id-ID')}
🕐 Jam Operasional: ${start_time.slice(0,5)} - ${end_time.slice(0,5)}
🔧 Status: Sistem berjalan normal

Pesan otomatis dari SmartLabo IoT System`;

                    // Attempt to send notification (with built-in retry logic)
                    const notificationSent = await sendWhatsAppNotification(notificationMessage);
                    
                    if (notificationSent) {
                        console.log(`📱 WhatsApp notification sent for Relay ${relay_id}`);
                    } else {
                        console.log(`⚠️ WhatsApp notification for Relay ${relay_id} will be retried later`);
                    }
                } else {
                    console.error(`❌ Failed to turn OFF Relay ${relay_id}`);
                }
            }
        }
    } catch (err) {
        console.error('Error in checkAndExecuteSchedules:', err);
    }
};

// Helper function untuk mengecek apakah waktu saat ini dalam rentang jadwal
function isTimeInRange(currentTime, startTime, endTime) {
    const current = timeToMinutes(currentTime);
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);

    if (start <= end) {
        // Normal case: start 07:00, end 17:00
        return current >= start && current <= end;
    } else {
        // Cross midnight case: start 22:00, end 06:00
        return current >= start || current <= end;
    }
}

// Helper function untuk convert time ke minutes
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// Helper function untuk toggle relay state
async function toggleRelayState(relayId, newState) {
    try {
        const { error } = await supabase
            .from('relays')
            .update({ 
                state: newState,
                updated_at: new Date().toISOString()
            })
            .eq('relay_id', relayId);

        if (error) throw error;

        // Log perubahan
        await supabase
            .from('relay_logs')
            .insert({
                relay_id: relayId,
                state: newState,
                waktu: new Date().toISOString()
            });

        return true;
    } catch (err) {
        console.error(`Error toggling relay ${relayId}:`, err);
        return false;
    }
}

// Helper function untuk mengirim notifikasi WhatsApp dengan retry logic
async function sendWhatsAppNotification(message) {
    try {
        const server = require('../server');
        
        if (server.broadcastAutomationNotification) {
            console.log('📱 Attempting to send WhatsApp notification...');
            const success = await server.broadcastAutomationNotification(message);
            
            if (success) {
                console.log('✅ WhatsApp notification sent successfully');
                return true;
            } else {
                console.log('⚠️ WhatsApp notification failed, but will be queued for retry');
                return false; // Still return false but message is queued
            }
        } else {
            console.log('⚠️ WhatsApp broadcast function not available');
            return false;
        }
    } catch (err) {
        console.error('❌ Error in WhatsApp notification process:', err.message);
        return false;
    }
}

// Fungsi untuk menjalankan pemeriksaan berkala
exports.startScheduleMonitoring = () => {
    console.log('Starting schedule monitoring...');
    
    // Jalankan pemeriksaan setiap menit
    setInterval(() => {
        exports.checkAndExecuteSchedules();
    }, 60000); // 60000ms = 1 menit

    // Jalankan sekali saat startup
    setTimeout(() => {
        exports.checkAndExecuteSchedules();
    }, 5000); // Delay 5 detik setelah startup
};

module.exports = exports;