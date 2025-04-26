// Langkah 1: Buat folder proyek baru dan inisialisasi npm
// mkdir whatsapp-bot
// cd whatsapp-bot
// npm init -y

// Langkah 2: Install dependensi yang diperlukan
// npm install whatsapp-web.js qrcode-terminal

// Langkah 3: Buat file index.js dengan kode berikut
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Inisialisasi client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Menyimpan sesi agar tidak perlu scan QR setiap kali
    puppeteer: {
        args: ['--no-sandbox'],
    }
});

// Event ketika QR code siap untuk di-scan
client.on('qr', (qr) => {
    console.log('QR CODE SIAP UNTUK DI-SCAN:');
    qrcode.generate(qr, {small: true});
});

// Event ketika client sedang loading
client.on('loading_screen', (percent, message) => {
    console.log('LOADING:', percent, '%', message);
});

// Event ketika client berhasil terhubung
client.on('ready', () => {
    console.log('Client sudah siap!');
    
    // Nomor tujuan (format: kode negara tanpa + diikuti nomor tanpa 0 di depan)
    const nomorTujuan = '6285602924733@c.us';
    
    // Pesan yang akan dikirim
    const pesan = 'Halo! Ini adalah pesan otomatis dari bot WhatsApp.js';
    
    // Kirim pesan
    client.sendMessage(nomorTujuan, pesan)
        .then(response => {
            console.log('Pesan berhasil dikirim!', response);
        })
        .catch(err => {
            console.error('Gagal mengirim pesan:', err);
        });
});

// Event ketika ada error
client.on('auth_failure', (msg) => {
    console.error('AUTENTIKASI GAGAL:', msg);
});

// Event ketika client terdiskoneksi
client.on('disconnected', (reason) => {
    console.log('Client terputus:', reason);
});

// Inisialisasi client
client.initialize();