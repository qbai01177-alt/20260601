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
};
let gameState = GAME_STATES.LOADING;

// 校正系統變數
let isCalibrating = false;
let calibrationTimer = 0;
let baseLipDist = 0; // 閉嘴時的基準上下唇距離
let lipDistHistory = [];
let calibrationError = ""; // 用於在畫面上顯示校正錯誤訊息

// 遊戲平衡參數（張嘴判定比例，可依據測試微調）
const JUMP_RATIO_THRESHOLD = 1.35;
const FACEMESH_OPTIONS = { maxFaces: 1, flipped: true };

// 遊戲核心計分與計時
let score = 0;
let highScore = 0;

// 物理系統：玩家（主角）物件
let player = {
  x: 100,
  y: 0,
  w: 40,
  h: 50,
  vy: 0,
  gravity: 0.7,
  jumpForce: -15,
  onGround: false,
  targetY: 0
};

// 障礙物與粒子系統
let obstacles = [];
let particles = [];
let nextObstacleFrame = 0;

// ----------------------------------------------------
// 💥 類別定義 (Classes)
// ----------------------------------------------------
class Obstacle {
  constructor(groundY) {
    this.x = width + 50;
    this.w = random(20, 40);
    this.h = random(40, 80);
    this.y = groundY - this.h; // 確保障礙物底部在地面線上
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

  // AABB 碰撞偵測優化 (縮小 20% 碰撞箱提高體感容錯率)
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
  // 建立全螢幕畫布
  createCanvas(windowWidth, windowHeight);
  player.y = height - 100 - player.h;
  player.targetY = player.y;

  // 1. 初始化視訊串流
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // 2. 使用 ml5 v1.x 標準的非同步載入機制，綁定 modelReady 回呼函式
  faceMesh = ml5.faceMesh(video, FACEMESH_OPTIONS, modelReady);

  // 讀取本地最高分紀錄
  if (localStorage.getItem("cyberGasp_highScore")) {
    highScore = int(localStorage.getItem("cyberGasp_highScore"));
  }
}

// 模型就緒後的處理函式
function modelReady() {
  console.log("FaceMesh 模型載入成功！");
  modelLoaded = true;
  gameState = GAME_STATES.CALIBRATION; // 安全進入校正提示畫面
  
  // 3. 模型確認就緒後，正式開啟臉部偵測監聽
  faceMesh.detectStart(video, gotFaces);
}

// 接收最新 AI 臉部辨識數據
function gotFaces(results) {
  faces = results;
}

function draw() {
  background(10, 10, 25); // 賽博朋克深紫夜空背景
  
  // 繪製全螢幕背景裝飾：隱約的科技風視訊畫面（低透明度保護隱私、內建水平翻轉視覺）
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(0, 180, 255, 30);
  image(video, 0, 0, width, height);
  pop();

  // 繪製地面地平線
  stroke(0, 255, 255, 100);
  strokeWeight(4);
  line(0, height - 100, width, height - 100);
  noStroke();
  fill(15, 15, 40);
  rectMode(CENTER);
  rect(width/2, height - 50, width, 100);

  // 核心場景狀態流控制
  if (!modelLoaded) {
    drawLoadingScreen();
  } else {
    switch (gameState) {
      case GAME_STATES.CALIBRATION: drawCalibrationScreen(); break;
      case GAME_STATES.PLAYING: playGame(); break;
      case GAME_STATES.GAME_OVER: drawGameOverScreen(); break;
      case GAME_STATES.PAUSED: drawPauseScreen(); break;
    }
  }

  // 獨立更新並繪製粒子系統（確保視覺特效絲滑）
  updateAndDrawParticles();
}

// ----------------------------------------------------
// 🎮 遊戲核心邏輯 (gameState = PLAYING)
// ----------------------------------------------------
function playGame() {
  score += 0.1; // 隨著存活時間增加分數

  handleFaceInput();
  updatePlayer();

  // 在跑酷前進時，腳底動態噴射霓虹拖曳粒子
  let groundLine = height - 100;
  if (player.onGround && frameCount % 3 === 0) {
    particles.push(new Particle(player.x, groundLine - 2, color(255, 0, 128), random(-3, -1), random(-1, 1)));
  } else if (!player.onGround) {
    // 空中噴射尾跡
    particles.push(new Particle(player.x + player.w/2, player.y + player.h, color(0, 255, 255), random(1, 3), random(-1, 1)));
  }

  drawPlayer();
  updateAndDrawObstacles();
  drawInGameUI();
}

function handleFaceInput() {
  if (faces.length > 0) {
    let face = faces[0];
    drawMiniFaceRadar(face);

    // 提取核心特徵點：最新版 ml5.faceMesh 唇部邊緣固定為 index 13（上唇）與 14（下唇）
    let topLip = face.keypoints[13];
    let botLip = face.keypoints[14];

    if (topLip && botLip) {
      let currentLipDist = dist(topLip.x, topLip.y, botLip.x, botLip.y);
      let currentRatio = currentLipDist / baseLipDist;

      // ⚠️ 核心機制：當前的唇距比例大於閾值，且主角在地面，即觸發跳躍
      if (currentRatio > JUMP_RATIO_THRESHOLD && player.onGround) {
        player.vy = player.jumpForce;
        player.onGround = false;
        // 觸發起跳爆發現象粒子
        createExplosion(player.x + player.w / 2, player.y + player.h, color(0, 255, 255), 15);
      }
    }
  } else {
    // 防呆機制：如果玩到一半臉移出鏡頭，自動進入出界暫停狀態
    gameState = GAME_STATES.PAUSED;
  }
}

function updatePlayer() {
  player.vy += player.gravity;
  player.y += player.vy;

  // 地面碰撞箱鎖定
  let groundLine = height - 100;
  if (player.y + player.h >= groundLine) {
    player.y = groundLine - player.h;
    player.vy = 0;
    player.onGround = true;
  }
}

function updateAndDrawObstacles() {
  let currentSpeed = 6 + floor(score / 100);
  let groundLine = height - 100;

  // 動態生成障礙物
  if (frameCount > nextObstacleFrame) {
    obstacles.push(new Obstacle(groundLine));
    nextObstacleFrame = frameCount + random(60, 120); // 隨機生成間隔
  }

  // 更新與檢查障礙物
  for (let i = obstacles.length - 1; i >= 0; i--) {
    let obs = obstacles[i];
    obs.update(currentSpeed);
    obs.draw();

    if (obs.collidesWith(player)) {
      // 💥 撞擊！觸發全螢幕大爆炸粒子並結束遊戲
      createExplosion(player.x + player.w / 2, player.y + player.h / 2, color(255, 255, 0), 40);
      endGame();
      return; 
    }

    // 移出螢幕外執行記憶體清除，防止網格卡頓崩潰
    if (obs.isOffscreen()) {
      obstacles.splice(i, 1);
    }
  }
}

// ----------------------------------------------------
// 🎨 介面與視覺場景渲染 (UI & Screens)
// ----------------------------------------------------
function drawLoadingScreen() {
  textAlign(CENTER, CENTER);
  fill(0, 255, 255);
  textSize(28);
  text("🎯 CYBER_PUNK EXPRESSION ENGINE LOADING...", width / 2, height / 2 - 20);
  noFill();
  stroke(0, 255, 255, 100);
  strokeWeight(3);
  ellipse(width/2, height/2 + 40, 50 + sin(frameCount * 0.1) * 15);
}

function drawCalibrationScreen() {
  textAlign(CENTER, CENTER);
  rectMode(CENTER);
  
  fill(255);
  textSize(46);
  text("CYBER GASP: NEON RUNNER", width / 2, height / 2 - 120);
  
  // 灰色半透明說明背板
  fill(20, 20, 45, 200);
  stroke(0, 255, 255);
  strokeWeight(2);
  rect(width / 2, height / 2, 550, 180, 10);
  noStroke();

  fill(200, 255, 255);
  textSize(18);
  if (!isCalibrating) {
    text("🎮 遊戲玩法：對著鏡頭【張大嘴巴】控制主角跳躍", width / 2, height / 2 - 50);
    text("請將手機調整為平視高度，確保面部清晰", width / 2, height / 2 - 20);
    fill(255, 255, 0);
    text("💡 提示：若辨識不穩，可在本畫面按鍵盤【S】快速強制作戰", width / 2, height / 2 + 10);
    
    // 點擊按鈕
    fill(255, 0, 128, 150 + sin(frameCount * 0.1) * 100);
    rect(width / 2, height / 2 + 55, 240, 45, 5);
    fill(255);
    textSize(20);
    text("點擊此處進行面部校正", width / 2, height / 2 + 55);
  } else {
    // 顯示校正錯誤訊息
    if (calibrationError) {
      fill(255, 100, 100);
      textSize(16);
      text(calibrationError, width / 2, height / 2 + 65);
    }

    // 進行 3 秒校正計時
    let elapsed = (millis() - calibrationTimer) / 1000;
    fill(0, 255, 255);
    textSize(24);
    text("🤖 面部黃金比例掃描中... 請維持面無表情", width / 2, height / 2 - 20);
    textSize(42);
    fill(255, 255, 0);
    text(max(0, ceil(3 - elapsed)) + "s", width / 2, height / 2 + 30);

    // 收集校正期間的唇距數據
    if (faces.length > 0 && faces[0].keypoints[13] && faces[0].keypoints[14]) {
      let d = dist(faces[0].keypoints[13].x, faces[0].keypoints[13].y, faces[0].keypoints[14].x, faces[0].keypoints[14].y);
      lipDistHistory.push(d);
    }

    if (elapsed >= 3) {
      if (lipDistHistory.length > 0) {
        let sum = 0;
        for (let d of lipDistHistory) sum += d;
        baseLipDist = sum / lipDistHistory.length;
        gameState = GAME_STATES.PLAYING; // 校正完畢，立刻開局！
        score = 0;
        obstacles = [];
        nextObstacleFrame = frameCount + 60;
      } else {
        isCalibrating = false;
        calibrationError = "❌ 未偵測到面部，請確保手機鏡頭已連線！";
      }
    }
  }
}

function drawPlayer() {
  push();
  translate(player.x, player.y);
  stroke(0, 255, 255);
  strokeWeight(2);
  fill(20, 40, 80);
  rectMode(CORNER);
  rect(0, 0, player.w, player.h, 4);
  noStroke();
  fill(0, 255, 255, 180 + sin(frameCount * 0.2) * 70);
  ellipse(player.w/2, player.h/3, 15, 15);
  pop();
}

function drawMiniFaceRadar(face) {
  push();
  fill(10, 10, 30, 220);
  stroke(0, 255, 255, 150);
  rectMode(CORNER);
  rect(20, 20, 110, 90, 5);
  
  // 縮小版雷達拓撲結構
  translate(20, 20);
  scale(110 / 640, 90 / 480); 
  noStroke();
  fill(0, 255, 255);
  for (let kp of face.keypoints) {
    ellipse(kp.x, kp.y, 4);
  }
  fill(255, 255, 0);
  if(face.keypoints[13]) ellipse(face.keypoints[13].x, face.keypoints[13].y, 12);
  if(face.keypoints[14]) ellipse(face.keypoints[14].x, face.keypoints[14].y, 12);
  pop();
}

function drawInGameUI() {
  textAlign(RIGHT, TOP);
  textSize(22);
  fill(255);
  text("SCORE: ", width - 110, 25);
  fill(0, 255, 255);
  text(floor(score), width - 30, 25);

  textAlign(LEFT, TOP);
  textSize(14);
  fill(150, 200, 255);
  text("⚡ 基準唇距: " + floor(baseLipDist) + "px", 150, 30);
}

function drawGameOverScreen() {
  textAlign(CENTER, CENTER);
  fill(255, 0, 128);
  textSize(54);
  text("MISSION OVER", width / 2, height / 2 - 60);
  
  fill(255);
  textSize(22);
  text("本次得分: " + floor(score), width / 2, height / 2);
  fill(0, 255, 255);
  text("太空紀錄保持: " + floor(highScore), width / 2, height / 2 + 35);
  
  rectMode(CENTER);
  fill(40, 40, 60);
  stroke(0, 255, 255);
  rect(width / 2, height / 2 + 105, 180, 45, 5);
  noStroke();
  fill(255);
  textSize(18);
  text("點擊按鈕重回戰場", width / 2, height / 2 + 105);
}

function drawPauseScreen() {
  if (faces.length > 0) {
    gameState = GAME_STATES.PLAYING; // 臉部回來了，自動續玩
  }
  
  stroke(255, 0, 80, 120 + sin(frameCount * 0.15) * 100);
  strokeWeight(6);
  noFill();
  rectMode(CENTER);
  rect(width/2, height/2, width - 12, height - 12);
  
  textAlign(CENTER, CENTER);
  noStroke();
  fill(255, 50, 50);
  textSize(32);
  text("⚠️ FACE OUT OF BOUNDS ⚠️", width / 2, height / 2 - 20);
  textSize(18);
  fill(230);
  text("請將面部對準手機鏡頭中央以解凍遊戲", width / 2, height / 2 + 25);
}

// ----------------------------------------------------
// 💥 特效系統 (Explosion System)
// ----------------------------------------------------
function createExplosion(x, y, col, count) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, col, random(-4, 4), random(-4, 4)));
  }
}

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].display();
    if (particles[i].alpha <= 0) particles.splice(i, 1);
  }
}

// ----------------------------------------------------
// 🖱 按鈕滑鼠範圍檢查與點擊控制
// ----------------------------------------------------
function isMouseInCenterRect(cx, cy, w, h) {
  return mouseX > cx - w / 2 && mouseX < cx + w / 2 &&
         mouseY > cy - h / 2 && mouseY < cy + h / 2;
}

function mousePressed() {
  if (!modelLoaded) return;

  if (gameState === GAME_STATES.CALIBRATION && !isCalibrating) {
    if (isMouseInCenterRect(width / 2, height / 2 + 55, 240, 45)) {
      isCalibrating = true;
      calibrationTimer = millis();
      lipDistHistory = [];
      calibrationError = ""; 
    }
  } else if (gameState === GAME_STATES.GAME_OVER) {
    if (isMouseInCenterRect(width / 2, height / 2 + 105, 180, 45)) {
      gameState = GAME_STATES.CALIBRATION; 
      isCalibrating = false;
    }
  }
}

function keyPressed() {
  // ⚡【強制作戰快捷鍵】若是在非教室環境下手機測試斷訊，按 S 鍵可以直接以默認值進入遊戲除錯
  if (gameState === GAME_STATES.CALIBRATION && !isCalibrating && (key === 's' || key === 'S')) {
    console.log("DEBUG: Skipping calibration, starting game with default values.");
    baseLipDist = 22; 
    gameState = GAME_STATES.PLAYING;
    score = 0;
    obstacles = [];
    nextObstacleFrame = frameCount + 60;
  }
}

function endGame() {
  gameState = GAME_STATES.GAME_OVER;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("cyberGasp_highScore", highScore);
  }
}

// ⚠️ 全螢幕自動縮放響應式支援 (RWD)
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  player.y = height - 100 - player.h;
}