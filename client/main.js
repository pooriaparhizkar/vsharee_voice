import { Room, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, AudioPresets } from 'https://cdn.skypack.dev/livekit-client';

let room;
let mic;
let cam;
let audioContext;
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
    playNotificationBeep();
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
