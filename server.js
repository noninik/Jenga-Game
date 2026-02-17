const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ========== ROOMS ==========
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function buildTowerData() {
  const blocks = [];
  const LAYERS = 18;
  for (let layer = 0; layer < LAYERS; layer++) {
    for (let i = 0; i < 3; i++) {
      blocks.push({
        id: blocks.length,
        layer: layer,
        index: i,
        removed: false,
        removedBy: null
      });
    }
  }
  return blocks;
}

function broadcastToRoom(roomCode, data, excludeWs) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(data);
  room.players.forEach(p => {
    if (p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function sendToAll(roomCode, data) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(data);
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function getRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  return {
    type: 'room-state',
    roomCode: roomCode,
    players: room.players.map(p => ({
      name: p.name,
      score: p.score,
      number: p.number
    })),
    blocks: room.blocks,
    currentTurn: room.currentTurn,
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
    winner: room.winner
  };
}

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerNumber = null;

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }

    switch (data.type) {

      case 'create-room': {
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();

        const room = {
          code: code,
          players: [{
            ws: ws,
            name: data.name || 'Player 1',
            score: 0,
            number: 1
          }],
          blocks: buildTowerData(),
          currentTurn: 1,
          gameStarted: false,
          gameOver: false,
          winner: null
        };
        rooms.set(code, room);
        playerRoom = code;
        playerNumber = 1;

        ws.send(JSON.stringify({
          type: 'room-created',
          roomCode: code,
          playerNumber: 1
        }));
        break;
      }

      case 'join-room': {
        const code = (data.roomCode || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found!' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full!' }));
          return;
        }

        room.players.push({
          ws: ws,
          name: data.name || 'Player 2',
          score: 0,
          number: 2
        });
        playerRoom = code;
        playerNumber = 2;

        ws.send(JSON.stringify({
          type: 'room-joined',
          roomCode: code,
          playerNumber: 2
        }));

        // Start game
        room.gameStarted = true;
        room.currentTurn = 1;

        sendToAll(code, getRoomState(code));
        sendToAll(code, {
          type: 'game-start',
          message: `Game started! ${room.players[0].name} goes first.`
        });
        break;
      }

      case 'remove-block': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room || !room.gameStarted || room.gameOver) return;

        if (room.currentTurn !== playerNumber) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not your turn!' }));
          return;
        }

        const blockId = data.blockId;
        const block = room.blocks[blockId];
        if (!block || block.removed) return;

        // Validate: can't remove from top full layer and layer must have >1 block
        const topLayer = Math.max(...room.blocks.filter(b => !b.removed).map(b => b.layer));
        if (block.layer === topLayer) {
          ws.send(JSON.stringify({ type: 'error', message: "Can't remove from top layer!" }));
          return;
        }
        const layerBlocks = room.blocks.filter(b => !b.removed && b.layer === block.layer);
        if (layerBlocks.length <= 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'Last block in this layer!' }));
          return;
        }

        // Remove block
        block.removed = true;
        block.removedBy = playerNumber;

        // Score
        const points = (block.layer + 1) * 10;
        const player = room.players.find(p => p.number === playerNumber);
        if (player) player.score += points;

        // Check collapse (random chance increases with removed blocks)
        const removedCount = room.blocks.filter(b => b.removed).length;
        const collapseChance = Math.max(0, (removedCount - 8) * 0.04);
        
        // Check structural collapse - middle block removed with no support
        let structuralCollapse = false;
        if (block.index === 1) { // middle block
          const remaining = room.blocks.filter(b => !b.removed && b.layer === block.layer);
          if (remaining.length === 2) {
            // Both side blocks left, that's ok
          } else if (remaining.length === 1) {
            structuralCollapse = Math.random() < 0.4;
          }
        }
        
        // More blocks removed from same layer = more danger
        const layerRemoved = 3 - room.blocks.filter(b => !b.removed && b.layer === block.layer).length;
        const dangerChance = collapseChance + (layerRemoved >= 2 ? 0.15 : 0);

        const collapsed = structuralCollapse || Math.random() < dangerChance;

        if (collapsed) {
          room.gameOver = true;
          // The player who caused collapse loses
          const otherPlayer = room.players.find(p => p.number !== playerNumber);
          room.winner = otherPlayer ? otherPlayer.number : null;

          sendToAll(playerRoom, {
            type: 'block-removed',
            blockId: blockId,
            removedBy: playerNumber,
            playerName: player ? player.name : 'Unknown'
          });

          setTimeout(() => {
            sendToAll(playerRoom, {
              type: 'tower-collapsed',
              collapsedBy: playerNumber,
              winner: room.winner,
              winnerName: otherPlayer ? otherPlayer.name : 'Nobody',
              scores: room.players.map(p => ({ name: p.name, score: p.score, number: p.number }))
            });
          }, 500);

        } else {
          // Switch turn
          room.currentTurn = room.currentTurn === 1 ? 2 : 1;

          sendToAll(playerRoom, {
            type: 'block-removed',
            blockId: blockId,
            removedBy: playerNumber,
            playerName: player ? player.name : 'Unknown'
          });
          sendToAll(playerRoom, getRoomState(playerRoom));
        }
        break;
      }

      case 'restart': {
        if (!playerRoom) return;
        const room = rooms.get(playerRoom);
        if (!room) return;

        room.blocks = buildTowerData();
        room.currentTurn = 1;
        room.gameStarted = true;
        room.gameOver = false;
        room.winner = null;
        room.players.forEach(p => p.score = 0);

        sendToAll(playerRoom, { type: 'game-restart' });
        sendToAll(playerRoom, getRoomState(playerRoom));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (playerRoom) {
      const room = rooms.get(playerRoom);
      if (room) {
        room.players = room.players.filter(p => p.ws !== ws);
        if (room.players.length === 0) {
          rooms.delete(playerRoom);
        } else {
          broadcastToRoom(playerRoom, {
            type: 'player-left',
            message: 'Opponent disconnected!'
          });
          room.gameStarted = false;
          room.gameOver = true;
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Jenga Multiplayer server on port ${PORT}`);
});
