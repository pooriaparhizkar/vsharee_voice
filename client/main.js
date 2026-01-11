import { Room, RoomEvent, createLocalAudioTrack } from 'https://cdn.skypack.dev/livekit-client';

let room;
let mic;
let muted = false; // بهتره پیش‌فرض false باشه که وقتی وصل شد صداش بره (یا برعکس طبق سلیقه)
const btn = document.getElementById('btn');
const statusDiv = document.getElementById('status');
const participantsList = document.getElementById('participants-list');
const countSpan = document.getElementById('count');

// 1. تابع گرفتن توکن
async function getToken() {
  const response = await fetch('/token');
  const data = await response.json();
  return data.token;
}

// 2. هندل کردن صدای دیگران
function handleTrackSubscribed(track, publication, participant) {
  if (track.kind === 'audio') {
    const element = track.attach();
    document.body.appendChild(element);
  }
}

// 3. تابع آپدیت کردن لیست کاربران (جدید)
function updateParticipants() {
  if (!room) return;

  participantsList.innerHTML = '';
  
  // الف) اضافه کردن خودمان (Local)
  const myName = room.localParticipant.identity;
  addParticipantToList(myName + " (You)", true);

  // ب) اضافه کردن بقیه (Remote)
  room.participants.forEach((participant) => {
    addParticipantToList(participant.identity, false);
  });

  // پ) آپدیت شمارنده (ریموت‌ها + خودمان)
  countSpan.innerText = room.participants.size + 1;
}

// تابع کمکی برای ساخت HTML هر نفر
function addParticipantToList(name, isLocal) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot"></span> ${name}`;
  participantsList.appendChild(li);
}


btn.onclick = async () => {
  // اگر قبلاً وصل شدیم، دکمه کار میوت/آن‌میوت انجام میده
  if (room && room.state === 'connected') {
    if (muted) {
      await mic.unmute();
      muted = false;
      btn.innerText = 'Mute';
      btn.style.backgroundColor = '#dc3545'; // قرمز برای میوت
    } else {
      await mic.mute();
      muted = true;
      btn.innerText = 'Unmute';
      btn.style.backgroundColor = '#28a745'; // سبز برای صحبت
    }
    return;
  }

  // پروسه اتصال
  try {
    btn.disabled = true;
    statusDiv.innerText = 'Connecting...';
    
    const token = await getToken();
    
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    // --- رویدادهای جدید برای لیست کاربران ---
    
    // وقتی کسی جدید میاد
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('Someone joined:', participant.identity);
      updateParticipants();
    });

    // وقتی کسی میره
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('Someone left:', participant.identity);
      updateParticipants();
    });

    // برای شنیدن صدا
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);

    // اتصال به سرور
    await room.connect('wss://livekit-voice.vsharee.com', token);
    statusDiv.innerText = 'Connected!';
    
    // راه اندازی میکروفون
    mic = await createLocalAudioTrack();
    await room.localParticipant.publishTrack(mic);
    
    // تنظیم وضعیت اولیه دکمه
    mic.unmute(); // پیش‌فرض باز باشه
    muted = false;
    btn.innerText = 'Mute';
    btn.style.backgroundColor = '#dc3545';
    btn.disabled = false;

    // آپدیت اولیه لیست (که خودمون رو نشون بده)
    updateParticipants();

  } catch (e) {
    console.error(e);
    statusDiv.innerText = 'Error: ' + e.message;
    btn.disabled = false;
  }
};

// خروج تمیز هنگام بستن پنجره
window.onbeforeunload = () => {
  if (room) room.disconnect();
};
