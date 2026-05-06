import { Room, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, AudioPresets } from 'https://cdn.skypack.dev/livekit-client@2.15.5';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch((error) => console.warn('Service worker cleanup failed:', error));

    if ('caches' in window) {
      caches.keys()
        .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
        .catch((error) => console.warn('Cache cleanup failed:', error));
    }
  });
}

let room;
let mic;
let cam;
let audioContext;
let buzzAudioElement;
let buzzAudioUrl;
let micMuted = false;
let camEnabled = false;
let currentFacingMode = 'user';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const endBtn = document.getElementById('end-btn'); // دکمه جدید
const flipBtn = document.getElementById('flip-btn');
const statusDiv = document.getElementById('status');
const participantsList = document.getElementById('participants-list');
const countSpan = document.getElementById('count');
const videoGrid = document.getElementById('video-grid');
const chatBox = document.querySelector('.chat-box');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

chatInput.disabled = true;

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function appendChatMessage(sender, message, type = 'other') {
  const li = document.createElement('li');
  li.className = `chat-message ${type}`;
  li.innerHTML = `<span class="chat-meta">${escapeHtml(sender)}</span>${escapeHtml(message)}`;
  chatMessages.appendChild(li);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatAvailability(enabled) {
  chatInput.disabled = !enabled;
  chatSendBtn.disabled = !enabled;
}

function setChatVisibility(visible) {
  if (!chatBox) return;
  chatBox.classList.toggle('is-hidden', !visible);
  if (!visible) {
    chatBox.style.height = '';
    chatBox.style.maxHeight = '';
  }
}

function syncChatBoxHeight() {
  if (!chatBox || chatBox.classList.contains('is-hidden')) return;

  const fallbackHeight = Math.min(Math.round(window.innerHeight * 0.65), 520);
  const gridHeight = Math.round(videoGrid.getBoundingClientRect().height);
  const targetHeight = Math.max(320, Math.min(gridHeight || fallbackHeight, 700));

  chatBox.style.height = `${targetHeight}px`;
  chatBox.style.maxHeight = `${targetHeight}px`;
}

function playNotificationBeep() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 900;
    gainNode.gain.value = 0.0001;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const now = audioContext.currentTime;
    gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
  } catch (err) {
    console.warn('Beep failed:', err);
  }
}

function isBuzzCommand(message) {
  return message.trim().toUpperCase() === 'BUZZ';
}

function createBuzzAudioUrl() {
  const sampleRate = 44100;
  const durationSeconds = 0.65;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const channels = 1;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const toneStepSeconds = 0.12;
  const attackSeconds = 0.02;
  const releaseStartSeconds = 0.5;

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const toneBand = Math.floor(t / toneStepSeconds);
    const frequency = toneBand % 2 === 0 ? 220 : 180;
    const phase = 2 * Math.PI * frequency * t;
    const square = Math.sin(phase) >= 0 ? 1 : -1;

    let envelope = 1;
    if (t < attackSeconds) {
      envelope = t / attackSeconds;
    } else if (t > releaseStartSeconds) {
      envelope = Math.max(0, (durationSeconds - t) / (durationSeconds - releaseStartSeconds));
    }

    const sample = Math.max(-1, Math.min(1, square * envelope * 0.25));
    view.setInt16(44 + (i * 2), sample * 32767, true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function ensureBuzzAudioElement() {
  if (buzzAudioElement) return buzzAudioElement;

  if (!buzzAudioUrl) {
    buzzAudioUrl = createBuzzAudioUrl();
  }

  buzzAudioElement = new Audio(buzzAudioUrl);
  buzzAudioElement.preload = 'auto';
  buzzAudioElement.playsInline = true;
  buzzAudioElement.setAttribute('playsinline', '');
  buzzAudioElement.setAttribute('webkit-playsinline', '');
  buzzAudioElement.load();

  return buzzAudioElement;
}

function primeBuzzAudioPlayback() {
  const mediaTone = ensureBuzzAudioElement();
  const previousVolume = mediaTone.volume;
  mediaTone.volume = 0;

  const primePromise = mediaTone.play();
  if (primePromise && typeof primePromise.then === 'function') {
    primePromise
      .then(() => {
        mediaTone.pause();
        mediaTone.currentTime = 0;
        mediaTone.volume = previousVolume;
      })
      .catch(() => {
        mediaTone.volume = previousVolume;
      });
    return;
  }

  mediaTone.pause();
  mediaTone.currentTime = 0;
  mediaTone.volume = previousVolume;
}

function playBuzzAlarm() {
  const mediaTone = ensureBuzzAudioElement();
  mediaTone.currentTime = 0;
  const mediaPromise = mediaTone.play();
  if (mediaPromise && typeof mediaPromise.catch === 'function') {
    mediaPromise.catch(() => {
      // Fallback for environments where media element playback is rejected.
      playBuzzAlarmWithWebAudio();
    });
  }
}

function playBuzzAlarmWithWebAudio() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(220, now);
    oscillator.frequency.setValueAtTime(180, now + 0.12);
    oscillator.frequency.setValueAtTime(220, now + 0.24);
    oscillator.frequency.setValueAtTime(180, now + 0.36);
    oscillator.frequency.setValueAtTime(220, now + 0.48);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.65);
  } catch (err) {
    console.warn('Buzz alarm failed:', err);
  }
}

function parseDataPayload(payload) {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array) return textDecoder.decode(payload);
  return '';
}

function handleDataReceived(payload, participant) {
  const text = parseDataPayload(payload);
  if (!text) return;

  try {
    const data = JSON.parse(text);
    if (data.type !== 'chat' || typeof data.message !== 'string') return;

    const senderName = participant?.identity || data.sender || 'Guest';
    appendChatMessage(senderName, data.message, 'other');
    if (isBuzzCommand(data.message)) {
      playBuzzAlarm();
    } else {
      playNotificationBeep();
    }
  } catch {
    // ignore non-chat payloads
  }
}

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message || !room || room.state !== 'connected') return;

  const packet = {
    type: 'chat',
    message,
    sender: room.localParticipant.identity,
    timestamp: Date.now(),
  };

  try {
    const encoded = textEncoder.encode(JSON.stringify(packet));
    try {
      await room.localParticipant.publishData(encoded, { reliable: true, topic: 'chat' });
    } catch {
      await room.localParticipant.publishData(encoded);
    }

    appendChatMessage('You', message, 'me');
    if (isBuzzCommand(message)) {
      playBuzzAlarm();
    }
    chatInput.value = '';
  } catch (err) {
    console.error('Chat send failed:', err);
    statusDiv.innerText = 'Chat Error: failed to send message.';
  }
}

chatSendBtn.onclick = sendChatMessage;
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendChatMessage();
});
window.addEventListener('resize', syncChatBoxHeight);

// تابع دریافت توکن
async function getToken() {
  const response = await fetch('/token');
  const data = await response.json();
  return data.token;
}

// --- مدیریت فول اسکرین ---
function toggleFullScreen(wrapperDiv) {
  const video = wrapperDiv.querySelector('video');
  if (!video) return;

  // iOS Safari fullscreen (video-only)
  if (video.webkitEnterFullscreen) {
    // Ensure playback resumes after exiting fullscreen (iOS bug fix)
    video.onwebkitendfullscreen = () => {
      video.play().catch(() => {});
    };
    video.webkitEnterFullscreen();
    return;
  }

  // Standard fullscreen (desktop / Android)
  if (!document.fullscreenElement) {
    wrapperDiv.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

// --- مدیریت دریافت ترک‌های جدید ---
function handleTrackSubscribed(track, publication, participant) {
  const element = track.attach(); // المان <video> یا <audio>
  element.playsInline = true;
  element.setAttribute('playsinline', '');
  element.setAttribute('webkit-playsinline', '');
  
  if (track.kind === 'video') {
    // 1. ساختن یک wrapper برای ویدیو و دکمه
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = 'wrapper-' + track.sid;

    // Mobile-friendly: tap video to go fullscreen
    wrapper.addEventListener('pointerup', (e) => {
      // Ignore taps on fullscreen button itself
      if (e.target.classList.contains('fs-btn')) return;
      toggleFullScreen(wrapper);
    });

    // 2. ساخت دکمه فول اسکرین
    const fsBtn = document.createElement('button');
    fsBtn.className = 'fs-btn';
    fsBtn.innerHTML = '⛶'; // آیکون
    fsBtn.title = "Full Screen";
    fsBtn.onclick = () => toggleFullScreen(wrapper);

    // 3. اضافه کردن ویدیو و دکمه به wrapper
    wrapper.appendChild(element);
    wrapper.appendChild(fsBtn);

    // 4. اضافه کردن wrapper به گرید
    videoGrid.appendChild(wrapper);
    syncChatBoxHeight();
  } else {
    // صداها تغییری نمی‌کنند
    document.body.appendChild(element);
  }
}

// --- مدیریت حذف ترک‌ها ---
function handleTrackUnsubscribed(track, publication, participant) {
  track.detach().forEach(element => element.remove());
  
  if (track.kind === 'video') {
    // حذف کل wrapper مربوط به این ویدیو
    const wrapper = document.getElementById('wrapper-' + track.sid);
    if (wrapper) wrapper.remove();
    syncChatBoxHeight();
  }
}

// آپدیت لیست کاربران آنلاین
function updateParticipants() {
  if (!room) return;
  participantsList.innerHTML = '';
  
  const myName = room.localParticipant.identity;
  addParticipantToList(myName + " (You)", true);

  room.remoteParticipants.forEach((participant) => {
    addParticipantToList(participant.identity, false);
  });

  countSpan.innerText = room.remoteParticipants.size + 1;
}

function addParticipantToList(name, isLocal) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot"></span> ${name}`;
  participantsList.appendChild(li);
}

// --- دکمه اتصال و میکروفون ---
micBtn.onclick = async () => {
  primeBuzzAudioPlayback();

  if (room && room.state === 'connected') {
    if (micMuted) {
      await mic.unmute();
      micMuted = false;
      micBtn.innerText = 'Mute Mic';
      micBtn.style.backgroundColor = '#dc3545'; // قرمز در حالت فعال برای قطع کردن
    } else {
      await mic.mute();
      micMuted = true;
      micBtn.innerText = 'Unmute Mic';
      micBtn.style.backgroundColor = '#28a745'; // سبز برای وصل کردن
    }
    return;
  }

  try {
    micBtn.disabled = true;
    statusDiv.innerText = 'Connecting...';
    const token = await getToken();
    
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        audio: { dtx: true, red: true },
        video: { simulcast: true } 
      }
    });

    room.on(RoomEvent.ParticipantConnected, () => updateParticipants());
    room.on(RoomEvent.ParticipantDisconnected, () => updateParticipants());
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.DataReceived, handleDataReceived);
    room.on(RoomEvent.Disconnected, () => {
      setChatVisibility(false);
      setChatAvailability(false);
    });

    await room.connect('wss://livekit-voice.vsharee.com', token);
    statusDiv.innerText = 'Connected!';
    ensureBuzzAudioElement();
    
    mic = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      preset: AudioPresets.speech 
    });
    await room.localParticipant.publishTrack(mic);
    
    mic.unmute(); 
    micMuted = false;
    micBtn.innerText = 'Mute Mic'; 
    micBtn.style.backgroundColor = '#dc3545';
    micBtn.disabled = false;
    
    camBtn.disabled = false;
    endBtn.disabled = false; // فعال کردن دکمه اتمام جلسه
    setChatVisibility(true);
    syncChatBoxHeight();
    setChatAvailability(true);
    appendChatMessage('System', 'You joined the room chat.', 'system');

    updateParticipants();

  } catch (e) {
    console.error(e);
    statusDiv.innerText = 'Error: ' + e.message;
    micBtn.disabled = false;
  }
};

// --- دکمه دوربین ---
camBtn.onclick = async () => {
  if (!room || room.state !== 'connected') return;

  camBtn.disabled = true;

  if (!camEnabled) {
    try {
      cam = await createLocalVideoTrack({
        resolution: { width: 320, height: 240 },
        frameRate: 15,
        facingMode: 'user' 
      });
      
      // انتشار ترک ویدیو
      const pub = await room.localParticipant.publishTrack(cam);
      
      // برای نمایش تصویر خودمان هم از همان منطق wrapper استفاده میکنیم
      // چون publishTrack مستقیماً TrackSubscribed را برای خودمان صدا نمیزند
      // باید دستی آن را به دام اضافه کنیم:
      const element = cam.attach();
      element.muted = true;
      element.playsInline = true;
      element.setAttribute('playsinline', '');
      element.setAttribute('webkit-playsinline', '');

      // Mirror only local front camera
      if (currentFacingMode === 'user') {
        element.classList.add('mirror');
      }
      
      const wrapper = document.createElement('div');
      wrapper.className = 'video-wrapper';
      wrapper.id = 'wrapper-local'; // آی‌دی ثابت برای خودمان

      wrapper.addEventListener('pointerup', (e) => {
        if (e.target.classList.contains('fs-btn')) return;
        toggleFullScreen(wrapper);
      });

      const fsBtn = document.createElement('button');
      fsBtn.className = 'fs-btn';
      fsBtn.innerHTML = '⛶';
      fsBtn.onclick = () => toggleFullScreen(wrapper);

      wrapper.appendChild(element);
      wrapper.appendChild(fsBtn);
      videoGrid.appendChild(wrapper);
      syncChatBoxHeight();

      camEnabled = true;
      camBtn.innerText = 'Camera On';
      camBtn.style.backgroundColor = '#dc3545';

      flipBtn.disabled = false;

    } catch (e) {
      console.error('Failed to get camera', e);
      statusDiv.innerText = 'Camera Error: ' + e.message;
    }
  } else {
    if (cam) {
      room.localParticipant.unpublishTrack(cam);
      cam.stop();
      cam.detach().forEach(el => el.remove());
      // حذف wrapper خودمان
      const localWrapper = document.getElementById('wrapper-local');
      if(localWrapper) localWrapper.remove();
      cam = null;
    }
    camEnabled = false;
    camBtn.innerText = 'Camera Off';
    camBtn.style.backgroundColor = '#6c757d';
    flipBtn.disabled = true;
    syncChatBoxHeight();
  }
  camBtn.disabled = false;
};

flipBtn.onclick = async () => {
  if (!cam || !room) return;

  // Toggle facing mode
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

  // Remove current camera
  room.localParticipant.unpublishTrack(cam);
  cam.stop();
  cam.detach().forEach(el => el.remove());

  const localWrapper = document.getElementById('wrapper-local');
  if (localWrapper) localWrapper.remove();

  // Recreate camera with new facing mode
  cam = await createLocalVideoTrack({
    resolution: { width: 320, height: 240 },
    frameRate: 15,
    facingMode: currentFacingMode
  });

  await room.localParticipant.publishTrack(cam);

  const element = cam.attach();
  element.muted = true;
  element.playsInline = true;
  element.setAttribute('playsinline', '');
  element.setAttribute('webkit-playsinline', '');

  if (currentFacingMode === 'user') {
    element.classList.add('mirror');
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = 'wrapper-local';

  wrapper.addEventListener('pointerup', (e) => {
    if (e.target.classList.contains('fs-btn')) return;
    toggleFullScreen(wrapper);
  });

  const fsBtn = document.createElement('button');
  fsBtn.className = 'fs-btn';
  fsBtn.innerHTML = '⛶';
  fsBtn.onclick = () => toggleFullScreen(wrapper);

  wrapper.appendChild(element);
  wrapper.appendChild(fsBtn);
  videoGrid.appendChild(wrapper);
  syncChatBoxHeight();
};

// --- دکمه اتمام جلسه ---
endBtn.onclick = async () => {
    if (!confirm('Are you sure you want to end the session for everyone?')) return;

    try {
        // درخواست به سرور برای بستن اتاق
        await fetch('/end-room', { method: 'POST' });
        
        // قطع اتصال لوکال
        if (room) room.disconnect();
        
        statusDiv.innerText = 'Session Ended.';
        currentFacingMode = 'user';
        window.location.reload(); // ریلود صفحه برای ریست شدن
    } catch (error) {
        console.error('Error ending room:', error);
    }
};

window.onbeforeunload = () => {
  if (room) room.disconnect();
};
