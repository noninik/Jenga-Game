// ============ JENGA MULTIPLAYER CLIENT ============

const $ = (id) => document.getElementById(id);

// ===== STATE =====
let ws = null;
let myNumber = 0;
let roomCode = '';
let gameState = null;

// ===== SCREENS =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ===== WEBSOCKET =====
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };

  ws.onclose = () => {
    console.log('Disconnected');
    showNotification('Connection lost! Refreshing...');
    setTimeout(() => location.reload(), 2000);
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ===== MESSAGE HANDLER =====
function handleMessage(data) {
  switch (data.type) {

    case 'room-created':
      roomCode = data.roomCode;
      myNumber = data.playerNumber;
      $('display-room-code').textContent = roomCode;
      showScreen('waiting-screen');
      break;

    case 'room-joined':
      roomCode = data.roomCode;
      myNumber = data.playerNumber;
      break;

    case 'error':
      $('menu-error').textContent = data.message;
      showNotification(data.message);
      break;

    case 'game-start':
      showScreen('game-screen');
      showNotification(data.message);
      break;

    case 'room-state':
      gameState = data;
      renderGame();
      break;

    case 'block-removed':
      animateBlockRemoval(data.blockId, data.removedBy);
      if (data.removedBy !== myNumber) {
        showNotification(`${data.playerName} removed a block!`);
      }
      break;

    case 'tower-collapsed':
      showCollapse();
      setTimeout(() => {
        showGameOver(data);
      }, 1500);
      break;

    case 'game-restart':
      $('gameover-popup').style.display = 'none';
      showScreen('game-screen');
      break;

    case 'player-left':
      showNotification(data.message);
      setTimeout(() => {
        showScreen('menu-screen');
      }, 2000);
      break;
  }
}

// ===== RENDER GAME =====
function renderGame() {
  if (!gameState) return;

  const state = gameState;

  // Player names & scores
  if (state.players[0]) {
    $('p1-name').textContent = state.players[0].name;
    $('p1-score').textContent = state.players[0].score;
  }
  if (state.players[1]) {
    $('p2-name').textContent = state.players[1].name;
    $('p2-score').textContent = state.players[1].score;
  }

  // Turn indicator
  const isMyTurn = state.currentTurn === myNumber;
  if (state.currentTurn === 1) {
    $('turn-text').textContent = isMyTurn ? '🟢 Your Turn!' : `${state.players[0]?.name}'s turn`;
    $('player1-info').classList.add('active-turn');
    $('player2-info').classList.remove('active-turn');
  } else {
    $('turn-text').textContent = isMyTurn ? '🟢 Your Turn!' : `${state.players[1]?.name}'s turn`;
    $('player1-info').classList.remove('active-turn');
    $('player2-info').classList.add('active-turn');
  }

  $('status-msg').textContent = isMyTurn
    ? '👆 Click a block to pull it out!'
    : '⏳ Wait for opponent...';

  // Build tower
  renderTower(state);
}

function renderTower(state) {
  const container = $('tower-container');

  // Find top layer
  const topLayer = Math.max(...state.blocks.filter(b => !b.removed).map(b => b.layer));

  // Group blocks by layer
  const layers = {};
  state.blocks.forEach(b => {
    if (!layers[b.layer]) layers[b.layer] = [];
    layers[b.layer].push(b);
  });

  let html = '<div class="tower" id="tower">';

  const maxLayer = Math.max(...Object.keys(layers).map(Number));
  for (let l = 0; l <= maxLayer; l++) {
    const layerBlocks = layers[l] || [];
    const isEven = l % 2 === 0;
    const colorClass = `color-${l % 4}`;
    const activeInLayer = layerBlocks.filter(b => !b.removed);
    const isTopLayer = l === topLayer;
    const isMyTurn = state.currentTurn === myNumber;

    html += `<div class="layer" data-layer="${l}">`;
    html += `<span class="layer-number">${l + 1}</span>`;

    layerBlocks.forEach(block => {
      let classes = ['block', colorClass];
      classes.push(isEven ? 'even-layer' : 'odd-layer');

      let clickable = false;

      if (block.removed) {
        classes.push('removed');
      } else if (isTopLayer) {
        classes.push('top-layer');
      } else if (activeInLayer.length <= 1) {
        classes.push('last-in-layer');
      } else if (!isMyTurn || state.gameOver) {
        classes.push('disabled');
      } else {
        clickable = true;
      }

      const style = `--layer: ${l}; --rand: ${Math.random().toFixed(2)}`;

      html += `<div class="${classes.join(' ')}"
                    data-block-id="${block.id}"
                    style="${style}"
                    ${clickable ? `onclick="clickBlock(${block.id})"` : ''}>
               </div>`;
    });

    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;

  // Scroll to top of tower
  container.scrollTop = container.scrollHeight;
}

// ===== CLICK BLOCK =====
function clickBlock(blockId) {
  if (!gameState || gameState.gameOver) return;
  if (gameState.currentTurn !== myNumber) {
    showNotification('Not your turn!');
    return;
  }

  send({
    type: 'remove-block',
    blockId: blockId
  });
}

// ===== ANIMATIONS =====
function animateBlockRemoval(blockId, removedBy) {
  const el = document.querySelector(`[data-block-id="${blockId}"]`);
  if (el) {
    el.classList.add('just-removed');
    el.classList.add(removedBy === 1 ? 'p1-removed' : 'p2-removed');
    setTimeout(() => {
      el.classList.add('removed');
      el.classList.remove('just-removed');
    }, 600);
  }
}

function showCollapse() {
  const tower = document.getElementById('tower');
  if (tower) {
    tower.classList.add('collapsing');
  }
}

// ===== GAME OVER =====
function showGameOver(data) {
  const isWinner = data.winner === myNumber;

  $('gameover-title').textContent = isWinner
    ? '🎉 You Win!'
    : '💥 Tower Collapsed!';

  $('gameover-msg').textContent = isWinner
    ? 'Your opponent collapsed the tower!'
    : 'You collapsed the tower...';

  let scoresHtml = '';
  data.scores.forEach(s => {
    const isW = s.number === data.winner;
    scoresHtml += `
      <div class="score-card ${isW ? 'winner' : ''}">
        <div class="sc-name">${s.name}</div>
        <div class="sc-score">${s.score}</div>
        <div class="sc-label">${isW ? '👑 Winner' : '💀 Lost'}</div>
      </div>
    `;
  });
  $('gameover-scores').innerHTML = scoresHtml;

  $('gameover-popup').style.display = 'flex';
}

// ===== NOTIFICATION =====
function showNotification(msg) {
  const el = $('notification');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

// ===== EVENT LISTENERS =====
$('btn-create').addEventListener('click', () => {
  const name = $('player-name').value.trim() || 'Player';
  $('menu-error').textContent = '';
  send({ type: 'create-room', name: name });
});

$('btn-join').addEventListener('click', () => {
  const name = $('player-name').value.trim() || 'Player';
  const code = $('room-code-input').value.trim().toUpperCase();
  $('menu-error').textContent = '';
  if (!code || code.length < 4) {
    $('menu-error').textContent = 'Enter a 4-letter room code!';
    return;
  }
  send({ type: 'join-room', name: name, roomCode: code });
});

$('btn-restart').addEventListener('click', () => {
  send({ type: 'restart' });
});

$('btn-back-menu').addEventListener('click', () => {
  $('gameover-popup').style.display = 'none';
  showScreen('menu-screen');
  location.reload();
});

$('btn-leave').addEventListener('click', () => {
  location.reload();
});

// Allow Enter key
$('player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});
$('room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});

// ===== START =====
connectWS();
