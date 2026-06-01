let video;
let handpose;
let predictions = [];
let modelLoadedFlag = false;

// 使用常數物件管理遊戲狀態，提高可讀性與可維護性
const GAME_STATE = {
  START: 0,
  PLAYING: 1,
  GAME_OVER: 2,
  PAUSED: 3,
};
// 遊戲狀態：0 = 載入/開始畫面, 1 = 遊戲進行中, 2 = 遊戲結束, 3 = 出界暫停
let gameState = GAME_STATE.START; 
let score = 0;
let highScore = 0;
let timer = 60; // 60秒倒數
let lastTimerCheck = 0;
// 飛機與物理參數
let planeX = 300;
let planeY = 300;
let targetX = 300;
let targetY = 300;
let easing = 0.15; // lerp 平滑系數

// 武器與冷卻機制
let bullets = [];
let lastShotTime = 0;
let shotCooldown = 300; // 射擊冷卻 300 毫秒

// 敵方障礙物（隕石）
let enemies = [];
let spawnRate = 45; // 每隔幾影格生成一個敵人

// 特效粒子系統
let particles = [];

function setup() {
  createCanvas(640, 480);
  
  // 初始化 WebCam 視訊並隱藏預設 HTML 標籤
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // 初始化 ml5.js Handpose 模型
  handpose = ml5.handpose(video, () => {
    console.log("Handpose 模型載入成功！");
    modelLoadedFlag = true;
  });

  // 持續監聽手部辨識結果
  handpose.on("predict", (results) => {
    predictions = results;
  });
  
  // 讀取歷史最高分
  if (localStorage.getItem("sky_highScore")) {
    highScore = int(localStorage.getItem("sky_highScore"));
  }
}

function draw() {
  background(10);
  
  // 1. 繪製背景視訊（霓虹科技感濾鏡 + 鏡像翻轉）
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(0, 150, 255, 45); // 科技藍調、低透明度保護隱私
  image(video, 0, 0, width, height);
  pop();

  // 2. 核心遊戲流程控制器 (Finite State Machine)
  if (!modelLoadedFlag) {
    drawLoadingScreen();
  } else {
    switch (gameState) {
      case GAME_STATE.START: // 開始畫面
        drawStartScreen();
        break;
      case GAME_STATE.PLAYING: // 遊戲中
        playGame();
        break;
      case GAME_STATE.GAME_OVER: // 遊戲結束
        drawGameOverScreen();
        break;
      case GAME_STATE.PAUSED: // 手部出界暫停
        drawPauseScreen();
        break;
    }
  }
  
  // 獨立繪製粒子特效（不受遊戲暫停影響，維持流暢感）
  updateAndDrawParticles();
}

// ----------------------------------------------------
// 🎮 核心遊戲邏輯
// ----------------------------------------------------
function playGame() {
  // 處理計時器
  if (millis() - lastTimerCheck >= 1000) {
    timer--;
    lastTimerCheck = millis();
    if (timer <= 0) {
      endGame();
    }
  }

  // 檢查 AI 是否捕捉到手部數據
  if (predictions.length > 0) {
    let hand = predictions[0];
    
    // 取得食指根部 (Index 5) 做為飛機操控點
    // 因為視訊鏡像了，座標 X 軸需要進行翻轉鏡射對齊
    let rawX = hand.landmarks[5][0];
    let rawY = hand.landmarks[5][1];
    targetX = width - rawX; 
    targetY = rawY;

    // 使用 lerp 達成絲滑流暢的視覺追隨，消除生理手震
    planeX = lerp(planeX, targetX, easing);
    planeY = lerp(planeY, targetY, easing);

    // 繪製科技霓虹手部骨架（提供玩家即時視覺回饋）
    drawHandSkeleton(hand);

    // 檢查手勢：大拇指尖(4) 與 食指尖(8) 的像素距離
    let thumbTip = hand.landmarks[4];
    let indexTip = hand.landmarks[8];
    let pinchDist = dist(width - thumbTip[0], thumbTip[1], width - indexTip[0], indexTip[1]);

    // 捏合判定（距離小於 28 像素）且過了冷卻時間
    if (pinchDist < 28 && millis() - lastShotTime > shotCooldown) {
      bullets.push({ x: planeX, y: planeY - 15 });
      lastShotTime = millis();
      // 觸發射擊光斑粒子
      createExplosion(planeX, planeY - 15, color(0, 255, 255), 5);
    }
  } else {
    // ⚠️ 防呆機制：如果遊戲中手移出鏡頭，觸發自動暫停
    gameState = GAME_STATE.PAUSED;
  }

  // 生成敵方障礙物
  if (frameCount % spawnRate === 0) {
    enemies.push({
      x: random(30, width - 30),
      y: -20,
      size: random(25, 50),
      speed: random(2, 5)
    });
  }

  // 更新與繪製子彈
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.y -= 8; // 子彈向上飛
    
    // 繪製霓虹激光子彈
    noStroke();
    fill(0, 255, 255);
    rectMode(CENTER);
    rect(b.x, b.y, 4, 15, 2);
    
    // 出界刪除
    if (b.y < 0) bullets.splice(i, 1);
  }

  // 更新與繪製敵方隕石
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.y += e.speed;

    // 繪製賽博朋克風敵機/隕石
    stroke(255, 0, 128);
    strokeWeight(2);
    fill(40, 20, 30);
    ellipse(e.x, e.y, e.size);
    // 內縮花紋
    noStroke();
    fill(255, 0, 128, 100);
    ellipse(e.x, e.y, e.size * 0.4);

    let wasDestroyed = false;
    // 碰撞偵測：子彈打中隕石
    for (let j = bullets.length - 1; j >= 0; j--) {
      let b = bullets[j];
      if (dist(b.x, b.y, e.x, e.y) < e.size / 2) {
        createExplosion(e.x, e.y, color(255, 0, 128), 15);
        enemies.splice(i, 1);
        bullets.splice(j, 1);
        score += 10;
        wasDestroyed = true;
        break;
      }
    }
    // 如果隕石已被子彈摧毀，立即處理下一個隕石
    if (wasDestroyed) continue;

    // 碰撞偵測：隕石撞擊玩家飛機 (縮小飛機碰撞箱至 15 像素提升容錯率)
    if (dist(planeX, planeY, e.x, e.y) < (e.size / 2 + 15)) {
      createExplosion(planeX, planeY, color(255, 255, 0), 30);
      enemies.splice(i, 1);
      score = max(0, score - 15); // 扣分處罰
      // 隕石撞到飛機後也消失，立即處理下一個隕石
      continue;
    }

    // 漏掉沒打中出界刪除
    if (e.y > height + 30) {
      enemies.splice(i, 1);
    }
  }

  // 繪製玩家控制的「霓虹特技飛機」
  drawPlayerPlane(planeX, planeY);

  // 顯示上方 UI 數據
  drawUI();
}

// ----------------------------------------------------
// 🎨 各種畫面視覺設計 (UI / Screens)
// ----------------------------------------------------
function drawLoadingScreen() {
  textAlign(CENTER, CENTER);
  fill(0, 255, 255);
  textSize(24);
  text("NEURAL NETWORK LOADING...", width / 2, height / 2 - 20);
  
  // 旋轉科技感光圈
  noFill();
  stroke(0, 255, 255, 150);
  strokeWeight(3);
  ellipse(width / 2, height / 2 + 40, 40 + sin(frameCount * 0.1) * 10);
}

function drawStartScreen() {
  textAlign(CENTER, CENTER);
  // 標題
  textSize(42);
  fontWeight(BOLD);
  fill(255, 255, 255);
  text("MASTER HAND", width / 2, height / 2 - 60);
  fill(0, 255, 255);
  text("SKY ADVENTURE", width / 2, height / 2 - 15);
  
  // 說明文字
  textSize(16);
  fill(200);
  text("🖐 舉起手掌控制飛機飛行", width / 2, height / 2 + 50);
  text("👌 👌 捏合大拇指與食指發射激光", width / 2, height / 2 + 80);
  
  // 提示點擊按鈕
  fill(255, 0, 128);
  rect(width / 2, height / 2 + 140, 180, 40, 5);
  fill(255);
  text("點擊畫布開始", width / 2, height / 2 + 140);
}

function drawGameOverScreen() {
  textAlign(CENTER, CENTER);
  fill(255, 0, 128);
  textSize(48);
  text("MISSION OVER", width / 2, height / 2 - 50);
  
  fill(255);
  textSize(20);
  text("本次得分: " + score, width / 2, height / 2 + 10);
  fill(0, 255, 255);
  text("歷史最高紀錄: " + highScore, width / 2, height / 2 + 40);
  
  fill(40, 40, 40);
  rect(width / 2, height / 2 + 110, 180, 40, 5);
  fill(255);
  text("再玩一次", width / 2, height / 2 + 110);
}

function drawPauseScreen() {
  // 當玩家手移開時的自動暫停頁面
  if (predictions.length > 0) {
    gameState = GAME_STATE.PLAYING; // 手回來了，自動繼續遊戲
  }
  
  // 繪製半透明警示紅框
  stroke(255, 0, 0, sin(frameCount * 0.1) * 150 + 100);
  strokeWeight(5);
  noFill();
  rectMode(CENTER);
  rect(width/2, height/2, width-10, height-10);
  
  textAlign(CENTER, CENTER);
  noStroke();
  fill(255, 50, 50);
  textSize(28);
  text("⚠️ 偵測不到手部數據 ⚠️", width / 2, height / 2 - 20);
  textSize(16);
  fill(255);
  text("請將手掌移回視訊畫面中央以繼續遊戲", width / 2, height / 2 + 20);
}

function drawUI() {
  // 左上角分數與時間
  textAlign(LEFT, TOP);
  textSize(18);
  fill(255);
  text("SCORE: ", 20, 20);
  fill(0, 255, 255);
  text(score, 95, 20);
  
  fill(255);
  text("TIME: ", 20, 45);
  if (timer < 10) fill(255, 0, 128); // 快沒時間變紅色
  else fill(0, 255, 255);
  text(timer + "s", 80, 45);
}

function drawPlayerPlane(x, y) {
  push();
  translate(x, y);
  
  // 推進器尾焰效果（動態粒子）
  if (frameCount % 2 === 0) {
    particles.push(new Particle(x + random(-5, 5), y + 25, color(255, 100, 0), -1, random(1, 3)));
  }

  // 飛機機身美術風格：霓虹戰機
  stroke(0, 255, 255);
  strokeWeight(2);
  fill(10, 30, 50);
  
  // 機翼
  triangle(-25, 10, 25, 10, 0, -20);
  // 核心機艙
  fill(0, 255, 255, 150);
  ellipse(0, -5, 10, 20);
  
  pop();
}

function drawHandSkeleton(hand) {
  // 繪製 21 個手部關節點
  for (let i = 0; i < hand.landmarks.length; i++) {
    let x = width - hand.landmarks[i][0]; // 水平翻轉
    let y = hand.landmarks[i][1];
    
    noStroke();
    // 針對控制點（食指根部）與射擊點（指尖）渲染亮色
    if (i === 5 || i === 4 || i === 8) {
      fill(255, 255, 0);
      ellipse(x, y, 9);
    } else {
      fill(0, 255, 255, 180);
      ellipse(x, y, 5);
    }
  }
}

// ----------------------------------------------------
// 💥 粒子特效系統 (Particle System)
// ----------------------------------------------------
class Particle {
  constructor(x, y, col, speedY, size) {
    this.x = x;
    this.y = y;
    this.vx = random(-2, 2);
    this.vy = speedY || random(-2, 2);
    this.alpha = 255;
    this.col = col;
    this.size = size || random(4, 8);
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 8;
  }
  display() {
    noStroke();
    let c = color(red(this.col), green(this.col), blue(this.col), this.alpha);
    fill(c);
    ellipse(this.x, this.y, this.size);
  }
}

function createExplosion(x, y, col, count) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, col));
  }
}

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].display();
    if (particles[i].alpha <= 0) {
      particles.splice(i, 1);
    }
  }
}

// ----------------------------------------------------
// 🖱 遊戲滑鼠點擊控制事件
// ----------------------------------------------------
function mousePressed() {
  if (!modelLoadedFlag) return;

  if (gameState === GAME_STATE.START) {
    // 點擊開始遊戲按鈕區域
    if (mouseX > width / 2 - 90 && mouseX < width / 2 + 90 &&
        mouseY > height / 2 + 120 && mouseY < height / 2 + 160) {
      startGame();
    }
  } else if (gameState === GAME_STATE.GAME_OVER) {
    // 點擊重新開始按鈕區域
    if (mouseX > width / 2 - 90 && mouseX < width / 2 + 90 &&
        mouseY > height / 2 + 90 && mouseY < height / 2 + 130) {
      startGame();
    }
  }
}

function startGame() {
  score = 0;
  timer = 60;
  bullets = [];
  enemies = [];
  gameState = GAME_STATE.PLAYING;
  lastTimerCheck = millis();
}

function endGame() {
  gameState = GAME_STATE.GAME_OVER;
  // 更新最高分紀錄到瀏覽器 LocalStorage
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("sky_highScore", highScore);
  }
}