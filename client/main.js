import { Room, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, AudioPresets, VideoPresets } from 'https://cdn.skypack.dev/livekit-client';

let room;
let mic;
let cam; // متغیر جدید برای دوربین
let micMuted = false;
let camEnabled = false; // پیش‌فرض دوربین خاموش

const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const statusDiv = document.getElementById('status');
const participantsList = document.getElementById('participants-list');
const countSpan = document.getElementById('count');
const videoGrid = document.getElementById('video-grid');

async function getToken() {
  const response = await fetch('/token');
  const data = await response.json();
  return data.token;
}

// --- تغییر مهم 1: هندل کردن ترک‌های ویدیویی ---
function handleTrackSubscribed(track, publication, participant) {
  const element = track.attach(); // ساختن تگ <audio> یا <video>
  
  if (track.kind === 'video') {
    // اگر ویدیو بود، اضافه به گرید
    videoGrid.appendChild(element);
  } else {
    // اگر صدا بود، مخفی به بدنه اضافه شود
    document.body.appendChild(element);
  }
}

// --- تغییر مهم 2: پاک کردن ویدیو هنگام قطع شدن ---
function handleTrackUnsubscribed(track, publication, participant) {
  track.detach().forEach(element => element.remove());
}

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

// --- لاجیک دکمه میکروفون ---
micBtn.onclick = async () => {
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
    
    // --- تنظیمات اتاق (سبک نگه داشتن صدا) ---
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // اینجا دیگه ویدیو رو غیرفعال نمیکنیم
      publishDefaults: {
        // تنظیمات بهینه صدا (DTX)
        audio: { dtx: true, red: true },
        // تنظیمات بهینه ویدیو (سیمولکست برای نت ضعیف)
        video: { simulcast: true } 
      }
    });

    // رویدادها
    room.on(RoomEvent.ParticipantConnected, () => updateParticipants());
    room.on(RoomEvent.ParticipantDisconnected, () => updateParticipants());
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    // رویداد جدید برای حذف ویدیو وقتی کسی دوربینش رو بست
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    await room.connect('wss://livekit-voice.vsharee.com', token);
    statusDiv.innerText = 'Connected!';
    
    // --- راه اندازی میکروفون (فوق سبک) ---
    mic = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      preset: AudioPresets.speech // بیت‌ریت پایین برای صدا
    });
    await room.localParticipant.publishTrack(mic);
    
    // آپدیت وضعیت دکمه‌ها
    mic.unmute(); micMuted = false;
    micBtn.innerText = 'Mute Mic'; micBtn.style.backgroundColor = '#dc3545';
    micBtn.disabled = false;
    camBtn.disabled = false; // فعال کردن دکمه دوربین بعد از اتصال

    updateParticipants();

  } catch (e) {
    console.error(e);
    statusDiv.innerText = 'Error: ' + e.message;
    micBtn.disabled = false;
  }
};

// --- لاجیک جدید: دکمه دوربین ---
camBtn.onclick = async () => {
  if (!room || room.state !== 'connected') return;

  camBtn.disabled = true; // جلوگیری از کلیک تکراری

  if (!camEnabled) {
    // === روشن کردن دوربین با تنظیمات فوق سبک ===
    try {
      cam = await createLocalVideoTrack({
        // رزولوشن بسیار پایین (320x240)
        resolution: VideoPresets.qvga.resolution,
        // فریم ریت پایین (نصف حالت عادی)
        frameRate: 15,
        // دوربین جلو (user) یا پشت (environment)
        facingMode: 'user' 
      });
      
      // انتشار و نمایش ویدیو خودمان
      await room.localParticipant.publishTrack(cam);
      const element = cam.attach();
      videoGrid.appendChild(element); // اضافه کردن به گرید

      camEnabled = true;
      camBtn.innerText = 'Camera On';
      camBtn.style.backgroundColor = '#dc3545'; // قرمز برای خاموش کردن

    } catch (e) {
      console.error('Failed to get camera', e);
      statusDiv.innerText = 'Camera Error: ' + e.message;
    }
  } else {
    // === خاموش کردن دوربین ===
    if (cam) {
      // توقف انتشار و حذف ترک
      room.localParticipant.unpublishTrack(cam);
      cam.stop();
      cam.detach().forEach(el => el.remove()); // حذف از صفحه
      cam = null;
    }
    camEnabled = false;
    camBtn.innerText = 'Camera Off';
    camBtn.style.backgroundColor = '#6c757d'; // خاکستری
  }
  camBtn.disabled = false;
};


window.onbeforeunload = () => {
  if (room) room.disconnect();
};