let video;
let faceMesh;
let faces = [];
let modelLoaded = false;

// 遊戲狀態機
const GAME_STATES = {
  LOADING: 0,
  CALIBRATION: 1,
  PLAYING: 2,
  GAME_OVER: 3,
  PAUSED: 4,
  VICTORY: 5 
};
let gameState = GAME_STATES.LOADING;

// 關卡階段定義
const STAGES = {
  STAGE1: "PHASE 1: ASTEROID BELT (星際穿越)",
  STAGE2: "PHASE 2: CYBER TURBULENCE (超載亂流)",
  BOSS: "FINAL PHASE: THE NEON TITAN (終極巨獸 BOSS 戰)"
};
let currentStage = STAGES.STAGE1;

// 校正系統變數
let isCalibrating = false;
let calibrationTimer = 0;
let baseLipDist = 0; 
let lipDistHistory = [];
let calibrationError = ""; 

// 遊戲平衡參數
const JUMP_RATIO_THRESHOLD = 1.35;
const FACEMESH_OPTIONS = { maxFaces: 1, flipped: true };

// 遊戲核心計分與魔王倒數
let score = 0;
let highScore = 0;
let bossTimer = 30; 
let lastBossTimeCheck = 0;

// 物理系統：玩家（主角）物件
let player = {
  x: 100,
  y: 0,
  w: 40,
  h: 50,
  vy: 0,
  gravity: 0.7,
  jumpForce: -15,
  onGround: false
};

// 陣列系統
let obstacles = [];
let particles = [];
let nextObstacleFrame = 0;
let bossLaserActive = false; 
let bossLaserTimer = 0;

// ----------------------------------------------------
// 💥 類別定義 (Classes) -> 之前漏掉這段會導致致命白屏
// ----------------------------------------------------
class Obstacle {
  constructor(groundY) {
    this.x = width + 50;
    this.w = random(20, 40);
    this.h = random(40, 80);
    this.y = groundY - this.h; 
  }

  update(speed) {
    this.x -= speed;
  }

  draw() {
    stroke(255, 0, 128);
    strokeWeight(3);
    fill(40, 10, 30);
    rectMode(CORNER);
    rect(this.x, this.y, this.w, this.h, 5);
    noStroke();
  }

  isOffscreen() {
    return this.x < -100;
  }

  collidesWith(p) {
    let tolerance = 0.8;
    let pLX = p.x + p.w * (1 - tolerance);
    let pRX = p.x + p.w * tolerance;
    let pTY = p.y + p.h * (1 - tolerance);
    let pBY = p.y + p.h;

    return (pRX > this.x && pLX < this.x + this.w &&
            pBY > this.y && pTY < this.y + this.h);
  }
}

class Particle {
  constructor(x, y, col, vy, vx) {
    this.x = x;
    this.y = y;
    this.vx = vx || random(-1, 1);
    this.vy = vy || random(-1, 1);
    this.alpha = 255;
    this.col = col;
    this.size = random(4, 9);
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 7;
  }
  display() {
    noStroke();
    let c = color(red(this.col), green(this.col), blue(this.col), this.alpha);
    fill(c);
    ellipse(this.x, this.y, this.size);
  }
}

// ----------------------------------------------------
// 核心 p5.js 函式 (Main p5.js Functions)
// ----------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight);
  player.y = height - 100 - player.h;

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // 修正點 2：使用與函式庫版本相容的事件監聽器模式
  faceMesh = ml5.faceMesh(video, FACEMESH_OPTIONS, () => {
    console.log("FaceMesh 模型載入成功！");
    modelLoaded = true;
    gameState = GAME_STATES.CALIBRATION;
  });

  // 持續監聽臉部辨識結果
  faceMesh.on('predict', (results) => {
    faces = results;
  });

  if (localStorage.getItem("cyberGasp_highScore")) {
    highScore = int(localStorage.getItem("cyberGasp_highScore"));
  }
}

function draw() {
  if (currentStage === STAGES.STAGE1) background(10, 10, 25);
  else if (currentStage === STAGES.STAGE2) background(25, 10, 20);
  else background(35, 5, 10); 
  
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(0, 180, 255, 25);
  image(video, 0, 0, width, height);
  pop();

  stroke(0, 255, 255, 100);
  strokeWeight(4);
  line(0, height - 100, width, height - 100);
  noStroke();
  fill(15, 15, 40);
  rectMode(CENTER);
  rect(width/2, height - 50, width, 100);

  if (!modelLoaded) {
    drawLoadingScreen();
  } else {
    switch (gameState) {
      case GAME_STATES.CALIBRATION: drawCalibrationScreen(); break;
      case GAME_STATES.PLAYING: playGame(); break;
      case GAME_STATES.GAME_OVER: drawGameOverScreen(); break;
      case GAME_STATES.PAUSED: drawPauseScreen(); break;
      case GAME_STATES.VICTORY: drawVictoryScreen(); break; 
    }
  }

  updateAndDrawParticles();
}

// ----------------------------------------------------
// 🎮 遊戲核心邏輯
// ----------------------------------------------------
function playGame() {
  if (score < 300) {
    currentStage = STAGES.STAGE1;
    score += 0.1; 
  } else if (score >= 300 && score < 800) {
    currentStage = STAGES.STAGE2;
    score += 0.15; 
  } else {
    currentStage = STAGES.BOSS; 
    handleBossBattleLogic();
  }

  handleFaceInput();
  updatePlayer();

  let groundLine = height - 100;
  if (player.onGround && frameCount % 3 === 0) {
    particles.push(new Particle(player.x, groundLine - 2, color(255, 0, 128), random(-3, -1), random(-1, 1)));
  } else if (!player.onGround) {
    particles.push(new Particle(player.x + player.w/2, player.y + player.h, color(0, 255, 255), random(1, 3), random(-1, 1)));
  }

  drawPlayer();
  
  if (currentStage === STAGES.BOSS) {
    drawBossTitan();
  } else {
    updateAndDrawObstacles();
  }
  
  drawInGameUI();
}

function handleBossBattleLogic() {
  if (millis() - lastBossTimeCheck >= 1000) {
    bossTimer--;
    lastBossTimeCheck = millis();
    if (bossTimer <= 0) {
      gameState = GAME_STATES.VICTORY; 
    }
  }

  if (frameCount % 180 === 0 && !bossLaserActive) {
    if (random() < 0.7) { 
      bossLaserActive = true;
      bossLaserTimer = frameCount; 
      createExplosion(width - 150, height - 150, color(255, 255, 0), 20); 
    }
  }

  if (bossLaserActive) {
    let elapsedLaser = frameCount - bossLaserTimer;
    
    if (elapsedLaser > 30 && elapsedLaser < 80) { 
      stroke(255, 255, 0, 220);
      strokeWeight(25);
      line(width - 120, height - 130, 0, height - 130);
      noStroke();

      let laserY = height - 130;
      if (player.y + player.h > laserY - 12 && player.y < laserY + 12) {
        createExplosion(player.x + player.w/2, player.y + player.h/2, color(255, 0, 0), 40);
        endGame();
      }
    }

    if (elapsedLaser >= 80) {
      bossLaserActive = false; 
    }
  }
}

function handleFaceInput() {
  if (faces.length >