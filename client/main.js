// client/main.js
import { Room, RoomEvent, createLocalAudioTrack } from 'https://cdn.skypack.dev/livekit-client';

let room;
let mic;
let muted = true; // پیش‌فرض میوت باشیم یا نه (تصمیم با خودته)
const btn = document.getElementById('btn');
const statusDiv = document.getElementById('status'); // برای نمایش وضعیت

// تابعی برای گرفتن توکن از بکند خودت
async function getToken() {
  const response = await fetch('http://localhost:4000/token');
  const data = await response.json();
  return data.token;
}

// تابعی برای هندل کردن صدای دیگران
function handleTrackSubscribed(track, publication, participant) {
  if (track.kind === 'audio') {
    // این متد یک المنت <audio> مخفی می‌سازد و صدا را پخش می‌کند
    const element = track.attach();
    document.body.appendChild(element);
  }
}

btn.onclick = async () => {
  if (!room) {
    btn.disabled = true;
    statusDiv.innerText = 'Connecting...';
    
    try {
      // 1. دریافت توکن
      const token = await getToken();
      
      // 2. ساخت اتاق
      room = new Room({
        // تنظیمات برای اینکه صدا به محض ورود بهتر پخش شه
        adaptiveStream: true,
        dynacast: true,
      });

      // 3. لیسنر برای شنیدن صدای دیگران (خیلی مهم)
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);

      // 4. وصل شدن به لایوکیت با توکن
      await room.connect('ws://localhost:7880', token);
      statusDiv.innerText = 'Connected! Join others.';

      // 5. آماده‌سازی میکروفون خودت
      mic = await createLocalAudioTrack();
      await room.localParticipant.publishTrack(mic);
      
      // وضعیت اولیه دکمه
      if (muted) {
        mic.mute();
        btn.innerText = 'Unmute';
      } else {
        mic.unmute();
        btn.innerText = 'Mute';
      }
      btn.disabled = false;

    } catch (e) {
      console.error(e);
      statusDiv.innerText = 'Error: ' + e.message;
      btn.disabled = false;
    }
    return;
  }

  // لاجیک ساده میوت/آن‌میوت
  if (muted) {
    mic.unmute();
    muted = false;
    btn.innerText = 'Mute';
  } else {
    mic.mute();
    muted = true;
    btn.innerText = 'Unmute';
  }
};

// برای اینکه وقتی پنجره بسته شد از اتاق خارج شه
window.onbeforeunload = () => {
  if (room) room.disconnect();
};