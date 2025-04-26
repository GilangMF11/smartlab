require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const session = require('express-session');
const authRoute = require('./routes/auth');
const sensorRoute = require('./routes/sensor')(io);
const relayRoute = require('./routes/relay')(io);

const { requireLogin } = require('./middleware/authMiddleware');

app.use(session({
  secret: 'smartlabo-anto-43212', // ganti ini dengan secret yang kuat
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // false untuk dev, true jika pakai HTTPS
}));


// Middleware
app.use(express.json()); // menerima JSON dari ESP8266

// Routing manual
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/login.html'));
});

// app.get('/dashboard', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', '/views/dashboard.html'));
// });
app.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/dashboard.html'));
});

app.get('/scan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/index.html'));
});

// Routing API sensor
app.use('/api/sensor', sensorRoute);
app.use('/api/auth', authRoute);
app.use('/api/relay', relayRoute);


// Setelah routing manual, baru public folder
app.use(express.static(path.join(__dirname, 'public')));


// WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox'],
  },
});

client.initialize();

// WhatsApp Events
client.on('qr', async (qr) => {
  console.log('QR RECEIVED');
  const qrDataURL = await qrcode.toDataURL(qr);
  io.emit('qr', qrDataURL);
  io.emit('message', 'QR Code received, please scan');
});

client.on('ready', () => {
  console.log('Client is ready!');
  io.emit('ready', 'WhatsApp is ready!');
  io.emit('message', 'WhatsApp is ready!');
});

client.on('authenticated', () => {
  console.log('AUTHENTICATED');
  io.emit('authenticated', 'Authenticated!');
  io.emit('message', 'Authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('AUTHENTICATION FAILURE', msg);
  io.emit('auth_failure', `Authentication failure: ${msg}`);
  io.emit('message', `Authentication failure: ${msg}`);
});

client.on('disconnected', (reason) => {
  console.log('Client was disconnected', reason);
  io.emit('disconnected', `Disconnected: ${reason}`);
  io.emit('message', `Disconnected: ${reason}`);
  client.initialize();
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('User connected');

  socket.on('sendMessage', (data) => {
    const { number, message } = data;
    const formattedNumber = `${number}@c.us`;

    client.sendMessage(formattedNumber, message)
      .then(() => {
        socket.emit('messageSent', {
          status: 'success',
          message: 'Message sent successfully'
        });
      })
      .catch((err) => {
        socket.emit('messageSent', {
          status: 'error',
          message: `Failed to send message: ${err}`
        });
      });
  });

  socket.on('checkStatus', () => {
    const status = client.info ? 'connected' : 'disconnected';
    socket.emit('status', { status });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Jalankan server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
