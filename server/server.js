// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';
import 'dotenv/config';

const app = express();
app.use(cors());

app.get('/token', async (req, res) => { // اضافه کردن async
  try {
    const roomName = 'public-room';
    const participantName = 'user-' + Math.random().toString(36).slice(2, 6);

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: '10m', // توکن برای ۱۰ دقیقه اعتبار داره
      }
    );

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    // در نسخه‌های جدید بهتره await بذاریم یا مستقیماً استرینگ رو بگیریم
    const token = await at.toJwt();

    // خروجی رو به صورت JSON برمی‌گردونیم که تمیزتره
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(4000, () => console.log('JWT backend running on :4000'));