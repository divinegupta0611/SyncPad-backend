const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:5173","https://sync-pad-frontend-83d2xo0qx-divinegupta0611s-projects.vercel.app","https://sync-pad-frontend-git-main-divinegupta0611s-projects.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

const io = socketIo(server, {
  cors: corsOptions,
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ['websocket', 'polling']
});

const rooms = new Map();
const activeUsers = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const userColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', 
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
];

function getRandomColor() {
  return userColors[Math.floor(Math.random() * userColors.length)];
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeRooms: rooms.size,
    activeUsers: activeUsers.size,
    uptime: process.uptime()
  });
});

app.get('/api/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ message: 'API is working', timestamp: new Date().toISOString() });
});

app.post('/api/rooms/create', (req, res) => {
  try {
    console.log('=== ROOM CREATE REQUEST ===');
    
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      name: req.body.name || `Room ${roomId}`,
      shapes: [],
      backgroundColor: '#ffffff',
      users: [],
      createdAt: new Date(),
      lastActivity: new Date()
    };
    
    rooms.set(roomId, room);
    
    console.log(`Room created: ${roomId}`);
    res.status(201).json({ 
      roomId: roomId, 
      room: room,
      message: 'Room created successfully'
    });
    
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ 
      error: 'Failed to create room',
      message: error.message 
    });
  }
});

app.get('/api/rooms/:roomId', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

app.get('/api/rooms', (req, res) => {
  try {
    const roomList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      userCount: room.users.length,
      lastActivity: room.lastActivity
    }));
    res.json(roomList);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

app.get('/api', (req, res) => {
  res.json({ 
    message: 'API root endpoint hit', 
    availableEndpoints: [
      'GET /api/test',
      'POST /api/rooms/create',
      'GET /api/rooms',
      'GET /api/rooms/:roomId'
    ],
    totalRooms: rooms.size,
    totalUsers: activeUsers.size
  });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  const connectionTime = Date.now();

  socket.on('join-room', (data) => {
    try {
      const { roomId, username } = data;
      const requestTime = Date.now();
      console.log(`Join room request: ${username} -> ${roomId} at ${requestTime}`);
      
      if (!roomId || !username) {
        console.log('Missing roomId or username');
        socket.emit('error', 'Room ID and username are required');
        return;
      }

      if (!rooms.has(roomId)) {
        console.log('Room not found:', roomId);
        socket.emit('error', 'Room not found');
        return;
      }

      const room = rooms.get(roomId);
      const existingUserIndex = room.users.findIndex(u => u.id === socket.id);
      
      const user = {
        id: socket.id,
        username: username.trim(),
        color: getRandomColor(),
        cursor: { x: 0, y: 0 },
        isActive: true,
        joinedAt: new Date()
      };

      if (existingUserIndex !== -1) {
        room.users[existingUserIndex] = user;
      } else {
        room.users.push(user);
      }
      
      room.lastActivity = new Date();
      
      activeUsers.set(socket.id, {
        userId: socket.id,
        username: user.username,
        roomId: roomId,
        cursor: user.cursor,
        color: user.color
      });

      socket.join(roomId);

      const responseTime = Date.now();
      const latency = responseTime - requestTime;
      console.log(`Room join latency: ${latency}ms`);

      socket.emit('room-joined', {
        room: room,
        userId: socket.id,
        shapes: room.shapes,
        backgroundColor: room.backgroundColor || '#ffffff',
        users: room.users,
        latency: latency
      });

      socket.to(roomId).emit('user-joined', {
        user: user,
        totalUsers: room.users.length
      });

      console.log(`User ${user.username} joined room ${roomId} (${latency}ms)`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Failed to join room');
    }
  });

  socket.on('shape-added', (data) => {
    try {
      const startTime = Date.now();
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const room = rooms.get(user.roomId);
      if (!room) return;

      const shapeWithUser = {
        ...data.shape,
        createdBy: user.username,
        createdAt: new Date()
      };

      room.shapes.push(shapeWithUser);
      room.lastActivity = new Date();

      socket.to(user.roomId).emit('shape-added', {
        shape: shapeWithUser,
        userId: user.userId
      });

      const endTime = Date.now();
      console.log(`Shape added broadcast: ${endTime - startTime}ms`);
    } catch (error) {
      console.error('Error handling shape-added:', error);
    }
  });

  socket.on('shape-updated', (data) => {
    try {
      const startTime = Date.now();
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const room = rooms.get(user.roomId);
      if (!room) return;

      const shapeIndex = room.shapes.findIndex(shape => shape.id === data.shape.id);
      if (shapeIndex !== -1) {
        room.shapes[shapeIndex] = {
          ...data.shape,
          lastModifiedBy: user.username,
          lastModifiedAt: new Date()
        };
        room.lastActivity = new Date();

        socket.to(user.roomId).emit('shape-updated', {
          shape: room.shapes[shapeIndex],
          userId: user.userId
        });

        const endTime = Date.now();
        console.log(`Shape updated broadcast: ${endTime - startTime}ms`);
      }
    } catch (error) {
      console.error('Error handling shape-updated:', error);
    }
  });

  socket.on('shape-deleted', (data) => {
    try {
      const startTime = Date.now();
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const room = rooms.get(user.roomId);
      if (!room) return;

      room.shapes = room.shapes.filter(shape => shape.id !== data.shapeId);
      room.lastActivity = new Date();

      socket.to(user.roomId).emit('shape-deleted', {
        shapeId: data.shapeId,
        userId: user.userId
      });

      const endTime = Date.now();
      console.log(`Shape deleted broadcast: ${endTime - startTime}ms`);
    } catch (error) {
      console.error('Error handling shape-deleted:', error);
    }
  });

  socket.on('canvas-cleared', () => {
    try {
      const startTime = Date.now();
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const room = rooms.get(user.roomId);
      if (!room) return;

      room.shapes = [];
      room.lastActivity = new Date();

      socket.to(user.roomId).emit('canvas-cleared', {
        userId: user.userId,
        clearedBy: user.username
      });

      const endTime = Date.now();
      console.log(`Canvas cleared broadcast: ${endTime - startTime}ms`);
    } catch (error) {
      console.error('Error handling canvas-cleared:', error);
    }
  });
  socket.on('background-changed', (data) => {
  try {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    room.backgroundColor = data.color;
    room.lastActivity = new Date();

    socket.to(user.roomId).emit('background-changed', {
      color: data.color,
      userId: user.userId
    });

    console.log(`Background changed to ${data.color} in room ${user.roomId}`);
  } catch (error) {
    console.error('Error handling background-changed:', error);
  }
});
  socket.on('cursor-move', (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      user.cursor = data.cursor;
      
      socket.to(user.roomId).emit('cursor-move', {
        userId: user.userId,
        username: user.username,
        color: user.color,
        cursor: data.cursor
      });
    } catch (error) {
      console.error('Error handling cursor-move:', error);
    }
  });

  socket.on('drawing-start', (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('drawing-start', {
        userId: user.userId,
        username: user.username,
        drawingData: data
      });
    } catch (error) {
      console.error('Error handling drawing-start:', error);
    }
  });

  socket.on('drawing-progress', (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('drawing-progress', {
        userId: user.userId,
        drawingData: data
      });
    } catch (error) {
      console.error('Error handling drawing-progress:', error);
    }
  });

  socket.on('drawing-end', (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('drawing-end', {
        userId: user.userId,
        drawingData: data
      });
    } catch (error) {
      console.error('Error handling drawing-end:', error);
    }
  });

  socket.on('tool-changed', (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      socket.to(user.roomId).emit('tool-changed', {
        userId: user.userId,
        username: user.username,
        tool: data.tool
      });
    } catch (error) {
      console.error('Error handling tool-changed:', error);
    }
  });

  socket.on('disconnect', () => {
    const disconnectTime = Date.now();
    console.log('User disconnected:', socket.id, 'at', disconnectTime);
    try {
      const user = activeUsers.get(socket.id);
      if (user) {
        const room = rooms.get(user.roomId);
        if (room) {
          room.users = room.users.filter(u => u.id !== socket.id);
          room.lastActivity = new Date();

          socket.to(user.roomId).emit('user-left', {
            userId: socket.id,
            username: user.username,
            totalUsers: room.users.length
          });

          if (room.users.length === 0) {
            setTimeout(() => {
              const currentRoom = rooms.get(user.roomId);
              if (currentRoom && currentRoom.users.length === 0) {
                rooms.delete(user.roomId);
                console.log(`Cleaned up empty room: ${user.roomId}`);
              }
            }, 24 * 60 * 60 * 1000);
          }
        }
        
        activeUsers.delete(socket.id);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });
});

app.use((error, req, res, next) => {
  console.error('Express error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

setInterval(() => {
  try {
    const now = new Date();
    const maxAge = 48 * 60 * 60 * 1000;
    
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.length === 0 && (now - room.lastActivity) > maxAge) {
        rooms.delete(roomId);
        console.log(`Cleaned up old room: ${roomId}`);
      }
    }
  } catch (error) {
    console.error('Error during room cleanup:', error);
  }
}, 60 * 60 * 1000);
// Change all localhost to frontend deployed link
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`API endpoints available at http://localhost:${PORT}/api`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };