import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { db } from './db';

const apiId = Number(import.meta.env.VITE_TELEGRAM_API_ID);
const apiHash = import.meta.env.VITE_TELEGRAM_API_HASH;

console.log("Init Telegram with:", { apiId, apiHash: apiHash ? "***" : "MISSING" });


let client: TelegramClient | null = null;

export async function getClient(): Promise<TelegramClient> {
  if (client) return client;

  const sessionEntry = await db.sessions.get('default');
  const sessionString = sessionEntry ? sessionEntry.sessionString : '';
  const stringSession = new StringSession(sessionString);

  if (!apiId || isNaN(apiId)) {
    throw new Error("Thiếu hoặc sai API ID trong file .env. Vui lòng khởi động lại server (npm run dev) nếu bạn vừa mới thêm .env");
  }

  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    deviceModel: 'TeleDrive Web',
    systemVersion: 'Windows',
    appVersion: '1.0.0',
  });

  return client;
}

export async function saveSession() {
  if (!client) return;
  const sessionString = (client.session as StringSession).save();
  const sessionStr = typeof sessionString === 'string' ? sessionString : String(sessionString);
  await db.sessions.put({ id: 'default', sessionString: sessionStr });
}

export async function checkAuth(): Promise<boolean> {
  try {
    const tgClient = await getClient();
    await tgClient.connect();
    return await tgClient.checkAuthorization();
  } catch (err) {
    console.error("Check Auth error:", err);
    return false;
  }
}

export async function logout() {
  if (client) {
    await client.disconnect();
    client = null;
  }
  await db.sessions.delete('default');
}

export async function sendPhoneCode(phoneNumber: string): Promise<any> {
  const tgClient = await getClient();
  await tgClient.connect();
  return await tgClient.sendCode({
    apiId,
    apiHash,
  }, phoneNumber);
}

export async function signInWithPhone(phoneNumber: string, phoneCodeHash: string, code: string): Promise<void> {
  const tgClient = await getClient();
  await tgClient.invoke(new Api.auth.SignIn({
    phoneNumber,
    phoneCodeHash,
    phoneCode: code
  }));
  await saveSession();
}

// Lưu ý: SignIn bằng QR Code đôi khi phức tạp do cần callback.
// Ta sẽ dùng signInUserWithQrCode
export async function startQrLogin(
  onQrCode: (qrUrl: string) => void,
  onPassword: () => Promise<string>
): Promise<void> {
  const tgClient = await getClient();
  await tgClient.connect();

  await tgClient.signInUserWithQrCode(
    { apiId, apiHash },
    {
      onError: (err) => console.error(err),
      qrCode: async (code: any) => {
        // code.token is a Buffer.
        // Convert to base64 first, then manually to base64url to ensure compatibility with all Buffer polyfills
        const tokenBase64 = code.token.toString('base64');
        const tokenStr = tokenBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const qrUrl = `tg://login?token=${tokenStr}`;
        onQrCode(qrUrl);
      },
      password: async () => {
        return await onPassword();
      }
    }
  );
  await saveSession();
}
