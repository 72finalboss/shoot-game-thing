const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // Thêm dòng này để xử lý đường dẫn thư mục

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấu hình để server phục vụ các file tĩnh (như index.html, hình ảnh,...) trong cùng thư mục dự án
app.use(express.static(path.join(__dirname)));

const players = {};

io.on('connection', (socket) => {
    console.log(`Người chơi kết nối: ${socket.id}`);
    players[socket.id] = { id: socket.id, x: 0, y: 1.6, z: 30, rx: 0, ry: 0 };

    socket.emit('current_players', players);
    socket.broadcast.emit('player_joined', players[socket.id]);

    socket.on('player_move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rx = data.rx;
            players[socket.id].ry = data.ry;
            socket.broadcast.emit('player_moved', players[socket.id]);
        }
    });

    socket.on('player_shoot', (data) => {
        socket.broadcast.emit('player_shot', data);
    });

    socket.on('disconnect', () => {
        console.log(`Người chơi thoát: ${socket.id}`);
        delete players[socket.id];
        io.emit('player_left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});