import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import 'dotenv/config';

// اگر فایل‌ها در پوشه client هستند، برای تست لوکال این خط‌ها را اضافه کن:
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ------------------------------------------------------------------

const app = express();
app.use(cors());

// سرو کردن فایل‌های استاتیک کلاینت (اختیاری اگر جدا اجرا نمیکنی)
app.use(express.static(path.join(__dirname, '../client'))); // فرض بر این است پوشه client یک مرحله عقب‌تر است
// یا اگر فایل‌ها کنار هم هستند: app.use(express.static(__dirname));

const svc = new RoomServiceClient(
  process.env.LIVEKIT_URL || 'https://livekit-voice.vsharee.com',
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

app.get('/token', async (req, res) => {
  try {
    const roomName = 'public-room';
    const participantName = 'user-' + Math.random().toString(36).slice(2, 6);

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: '10m',
      }
    );

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/end-room', async (req, res) => {
  try {
    await svc.deleteRoom('public-room');
    res.json({ message: 'Room closed' });
  } catch (error) {
    if (error.message && error.message.includes('not found')) {
        return res.json({ message: 'Room already closed' });
    }
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// --- دکمه قرمز اورژانسی: حذف اجباری اتاق ---
app.get('/force-kill', async (req, res) => {
  try {
    const roomName = 'public-room'; // همان اسمی که در کد استفاده کردی
    
    // این دستور به سرور لایوکیت میگه اتاق رو کلاً نابود کن
    // این کار باعث میشه همه (شامل همسرت) فوراً دیسکانکت بشن
    await svc.deleteRoom(roomName);
    
    console.log(`Room ${roomName} destroyed!`);
    res.send(`<h1>اتاق با موفقیت بسته شد. همسرتان دیسکانکت شد. خیالت راحت! 😴</h1>`);
    
  } catch (error) {
    // حتی اگر اتاق پیدا نشد هم یعنی قبلا بسته شده، پس خوبه
    console.log("Error deleting room (maybe already empty):", error.message);
    res.send(`<h1>اتاق قبلاً بسته شده بود یا مشکلی پیش آمد. (ارور: ${error.message})</h1>`);
  }
});

app.listen(4000, () => console.log('Backend running on :4000'));