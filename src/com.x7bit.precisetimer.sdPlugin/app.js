$SD.on('connected', (jsonObj) => connected(jsonObj));

function connected(jsn) {
  debugLog('Connected Plugin:', jsn);

  // Subscribe to the willAppear and other events
  $SD.on('com.x7bit.precisetimer.action.willAppear', jsonObj =>
    action.onWillAppear(jsonObj)
  );
  $SD.on('com.x7bit.precisetimer.action.didReceiveSettings', jsonObj =>
    action.onDidReceiveSettings(jsonObj)
  );
  $SD.on('com.x7bit.precisetimer.action.willDisappear', jsonObj =>
    action.onWillDisappear(jsonObj)
  );
  $SD.on('com.x7bit.precisetimer.action.keyDown', (jsonObj) =>
    action.onKeyDown(jsonObj)
  );
  $SD.on('com.x7bit.precisetimer.action.keyUp', jsonObj =>
    action.onKeyUp(jsonObj)
  );
};

const action = {
  hours: null,
  minutes: null,
  seconds: null,
  timer: null,
  keyDownMs: null,

  onWillAppear: function (jsn) {
    this.hours = this.getIntegerSetting(jsn, 'hours');
    this.minutes = this.getIntegerSetting(jsn, 'minutes');
    this.seconds = this.getIntegerSetting(jsn, 'seconds');

    if (this.timer) {
      if (this.timer.context !== jsn.context) {
        this.timer.reset();
        this.timer.context = jsn.context;
      } else {
        if (this.timer.isRunning) {
          this.timer.addInterval(null, true);
        } else if (this.timer.timerStartMs) {  // Paused, but started
          this.timer.drawRemainingText();
        } else {
          $SD.api.setImage(this.context);
        }
      }
    } else {
      this.timer = new CountdownTimer(this.hours, this.minutes, this.seconds, jsn.context);
    }
  },

  onDidReceiveSettings: function(jsn) {
    this.hours = this.getIntegerSetting(jsn, 'hours');
    this.minutes = this.getIntegerSetting(jsn, 'minutes');
    this.seconds = this.getIntegerSetting(jsn, 'seconds');

    const goalSec = this.hours * 3600 + this.minutes * 60 + this.seconds;
    if (this.timer.goalSec !== goalSec) {
      this.timer.goalSec = goalSec;
    }

    if (this.timer.timerStartMs) {  // If started
      this.timer.drawRemainingText();
    }
  },

  onWillDisappear: function(jsn) {
    this.timer.remInterval(null, true);
  },

  onKeyDown: function (jsn) {
    this.keyDownMs = Date.now();
    if (this.timer.isRunning) {
      this.timer.remInterval();
    }
  },

  onKeyUp: function (jsn) {
    const nowMs = Date.now();
    const keyElapsedMs = nowMs - this.keyDownMs;
    if (keyElapsedMs < 2000) {  // Short Press
      if (this.timer.isRunning) {
        this.timer.pause(nowMs);
      } else {
        this.timer.start(nowMs);
      }
    } else {  // Long Press
      this.timer.reset();
    }
  },

  getIntegerSetting(jsn, name, defValue = 0) {
    const settings = jsn.payload.settings ?? {};
    if (settings.hasOwnProperty(name)) {
      const value = parseInt(settings[name]);
      return value === NaN ? defValue : value;
    } else {
      return defValue;
    }
  }

};

class CountdownTimer {
  goalSec;
  timerStartMs;
  pauseStartMs;
  isRunning;
  intervalId;
  canvasTimer;
  context;

  constructor(hours, minutes, seconds, context) {
    this.goalSec = hours * 3600 + minutes * 60 + seconds;
    this.timerStartMs = null;
    this.pauseStartMs = null;
    this.isRunning = false;
    this.intervalId = null;
    this.canvasTimer = new CanvasTimer();
    this.context = context;
  }

  getElapsedSec(nowMs = null) {
    const startMs = (
      this.isRunning ?
      nowMs ?? Date.now() :
      this.pauseStartMs ?? this.timerStartMs
    );
    return Math.round((startMs - this.timerStartMs) / 1000);
  }

  start(nowMs) {
    if (!this.isRunning) {
      if (this.goalSec > 0) {
        const pauseElapsedMs = nowMs - this.pauseStartMs;
        this.timerStartMs += pauseElapsedMs;
        this.pauseStartMs = null;
        this.isRunning = true;
        this.addInterval(nowMs, true);
      } else {
        $SD.api.showAlert(this.context);
      }
    }
  }

  pause(nowMs) {
    if (this.isRunning) {
      this.pauseStartMs = nowMs;
      this.isRunning = false;
      this.remInterval(nowMs, true);
    }
  }

  reset() {
    this.timerStartMs = null;
    this.pauseStartMs = null;
    this.isRunning = false;
    this.remInterval();
    $SD.api.setImage(this.context);
  }

  addInterval(nowMs = null, updateImmediately = false) {
    if (this.isRunning) {
      if (updateImmediately) {
        this.drawRemainingText(nowMs);
      }

      setTimeout(() => {
        this.drawRemainingText();
      }, 10);
      this.intervalId = setInterval(() => {
        this.drawRemainingText();
      }, 1000);
    }
  }

  remInterval(nowMs = null, updateImmediately = false) {
    if (updateImmediately) {
      this.drawRemainingText(nowMs);
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  drawRemainingText(nowMs = null) {
    const elapsedSec = this.getElapsedSec(nowMs);
    if (elapsedSec < this.goalSec) {
      this.canvasTimer.drawTimer(this.context, elapsedSec, this.goalSec, this.isRunning);
    } else {
      this.reset();
      $SD.api.showOk(this.context);
      document.getElementById('audio-alarm').play();
    }
  }
};

class CanvasTimer {
  canvas;
  ctx;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 144;
    this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
  }

  drawTimer(context, elapsedSec, goalSec, isRunning) {
    //Background
    const img = document.getElementById(isRunning ? 'timer-bg-running' : 'timer-bg-pause');
    this.ctx.drawImage(img, 0, 0, 144, 144);
    //Foreground Text
    const remainingText = this.getRemainingText(elapsedSec, goalSec);
    const fSize = this.getFontSize(remainingText.length);
    const fSizeThird = fSize / 3;
    this.ctx.fillStyle = isRunning ? '#5881e0' : '#606060';
    this.ctx.font = `${fSize}px arial`;
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(remainingText, 72, (144 + fSizeThird) / 2);
    //Foreground Circles
    if (isRunning) {
      for (let i = 0; i < 3 && i <= elapsedSec; i++) {
        const circleOffset = (Math.abs(((elapsedSec + 3 - i) % 4) - 2) - 1) * 14;
        this.ctx.beginPath();
        this.ctx.arc(72 + circleOffset, 96 + fSizeThird, 6, 0, 2 * Math.PI, false);
        this.ctx.fillStyle = this.getCircleColor(i);
        this.ctx.fill();
        if (i == 1 && circleOffset !== 0) {
          break;
        }
      }
    }
    //Draw Canvas
    $SD.api.setImage(context, this.canvas.toDataURL());
  }

  getRemainingText(elapsedSec, goalSec) {
    const totalSec = goalSec - elapsedSec;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return (
      goalSec < 3600 ?
      `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` :
      `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    );
  }

  getFontSize(len) {
    if (len <= 5) {
      return 38;
    }
    return len > 7 ? 32 - len / 2 : 32;
  }

  getCircleColor(index) {
    switch (index) {
      case 0:
        return '#3d6ee0';
      case 1:
        return '#162a52';
      default:
        return '#0f1d35';
    }
  }
};
