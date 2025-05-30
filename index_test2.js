// Buat file package.json dengan menjalankan:
// npm init -y
// Lalu install dependencies yang diperlukan:
// npm install express socket.io whatsapp-web.js qrcode

// File: server.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox'],
  }
});

// WhatsApp events
client.on('qr', async (qr) => {
  try {
    console.log('QR RECEIVED', qr);
    // Generate QR code as data URL
    const qrDataURL = await qrcode.toDataURL(qr);
    io.emit('qr', qrDataURL);
    io.emit('message', 'QR Code received, scan please!');
  } catch (err) {
    console.error('QR Code generation error:', err);
  }
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
  
  // Reinitialize client if disconnected
  client.initialize();
});

// Initialize WhatsApp client
client.initialize();

// Socket.IO events
io.on('connection', (socket) => {
  console.log('✅ User Connected');
  
  // Send message event
  socket.on('sendMessage', (data) => {
    const { number, message } = data;
    
    // Format the number
    const formattedNumber = `${number}@c.us`;
    
    // Send message
    client.sendMessage(formattedNumber, message)
      .then(response => {
        socket.emit('messageSent', { 
          status: 'success', 
          message: 'Message sent successfully' 
        });
        socket.emit('message', `Message sent to ${number}`);
      })
      .catch(err => {
        socket.emit('messageSent', { 
          status: 'error', 
          message: `Failed to send message: ${err}` 
        });
        socket.emit('message', `Error sending message: ${err}`);
      });
  });

  // Check connection status event
  socket.on('checkStatus', () => {
    const status = client.info ? 'connected' : 'disconnected';
    socket.emit('status', { status });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});