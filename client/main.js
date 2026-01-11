import { Room, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, AudioPresets } from 'https://cdn.skypack.dev/livekit-client';

let room;
let mic;
let cam;
let micMuted = false;
let camEnabled = false;

const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const statusDiv = document.getElementById('status');
const participantsList = document.getElementById('participants-list');
const countSpan = document.getElementById('count');
const videoGrid = document.getElementById('video-grid');

// تابع دریافت توکن
async function getToken() {
  const response = await fetch('/token');
  const data = await response.json();
  return data.token;
}

// مدیریت دریافت ترک‌های جدید (صدا و تصویر)
function handleTrackSubscribed(track, publication, participant) {
  const element = track.attach();
  
  if (track.kind === 'video') {
    // ویدیوها به گرید اضافه می‌شوند
    videoGrid.appendChild(element);
  } else {
    // صداها به بدنه (مخفی) اضافه می‌شوند
    document.body.appendChild(element);
  }
}

// مدیریت حذف ترک‌ها (وقتی کسی دوربین را خاموش می‌کند یا می‌رود)
function handleTrackUnsubscribed(track, publication, participant) {
  track.detach().forEach(element => element.remove());
}

// آپدیت لیست کاربران آنلاین
function updateParticipants() {
  if (!room) return;
  participantsList.innerHTML = '';
  
  // خودمان
  const myName = room.localParticipant.identity;
  addParticipantToList(myName + " (You)", true);

  // بقیه
  room.remoteParticipants.forEach((participant) => {
    addParticipantToList(participant.identity, false);
  });

  // تعداد کل (ریموت + خودمان)
  countSpan.innerText = room.remoteParticipants.size + 1;
}

function addParticipantToList(name, isLocal) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot"></span> ${name}`;
  participantsList.appendChild(li);
}

// --- دکمه اتصال و میکروفون ---
micBtn.onclick = async () => {
  // اگر قبلاً وصل شدیم، نقش دکمه Mute/Unmute را دارد
  if (room && room.state === 'connected') {
    if (micMuted) {
      await mic.unmute();
      micMuted = false;
      micBtn.innerText = 'Mute Mic';
      micBtn.style.backgroundColor = '#dc3545';
    } else {
      await mic.mute();
      micMuted = true;
      micBtn.innerText = 'Unmute Mic';
      micBtn.style.backgroundColor = '#28a745';
    }
    return;
  }

  // پروسه اتصال اولیه
  try {
    micBtn.disabled = true;
    statusDiv.innerText = 'Connecting...';
    const token = await getToken();
    
    // تنظیمات اتاق (بهینه برای مصرف کم)
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        audio: { dtx: true, red: true }, // DTX: قطع ارسال دیتا در سکوت
        video: { simulcast: true } 
      }
    });

    // رویدادها
    room.on(RoomEvent.ParticipantConnected, () => updateParticipants());
    room.on(RoomEvent.ParticipantDisconnected, () => updateParticipants());
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    await room.connect('wss://livekit-voice.vsharee.com', token);
    statusDiv.innerText = 'Connected!';
    
    // میکروفون با تنظیمات فوق سبک (Speech Preset)
    mic = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      preset: AudioPresets.speech 
    });
    await room.localParticipant.publishTrack(mic);
    
    // وضعیت اولیه دکمه‌ها
    mic.unmute(); 
    micMuted = false;
    micBtn.innerText = 'Mute Mic'; 
    micBtn.style.backgroundColor = '#dc3545';
    micBtn.disabled = false;
    
    // فعال کردن دکمه دوربین
    camBtn.disabled = false;

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
    // === روشن کردن دوربین ===
    try {
      cam = await createLocalVideoTrack({
        // رزولوشن دستی (خیلی سبک - ۳۲۰ در ۲۴۰)
        resolution: { width: 320, height: 240 },
        // ۱۵ فریم بر ثانیه برای صرفه‌جویی در نت
        frameRate: 15,
        facingMode: 'user' 
      });
      
      await room.localParticipant.publishTrack(cam);
      
      // نمایش تصویر خودمان
      const element = cam.attach();
      videoGrid.appendChild(element);

      camEnabled = true;
      camBtn.innerText = 'Camera On';
      camBtn.style.backgroundColor = '#dc3545';

    } catch (e) {
      console.error('Failed to get camera', e);
      statusDiv.innerText = 'Camera Error: ' + e.message;
    }
  } else {
    // === خاموش کردن دوربین ===
    if (cam) {
      room.localParticipant.unpublishTrack(cam);
      cam.stop();
      cam.detach().forEach(el => el.remove());
      cam = null;
    }
    camEnabled = false;
    camBtn.innerText = 'Camera Off';
    camBtn.style.backgroundColor = '#6c757d';
  }
  camBtn.disabled = false;
};

// خروج هنگام بستن تب
window.onbeforeunload = () => {
  if (room) room.disconnect();
};