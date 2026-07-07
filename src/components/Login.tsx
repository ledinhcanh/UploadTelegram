import React, { useState, useEffect } from 'react';
import { QrCode, Phone, ArrowRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { startQrLogin, sendPhoneCode, signInWithPhone } from '../lib/telegram';

interface LoginProps {
  onLogin: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    
    if (loginMethod === 'qr') {
      setLoading(true);
      setError('');
      startQrLogin(
        (url) => {
          if (isMounted) {
            setQrUrl(url);
            setLoading(false);
          }
        },
        async () => {
          // Xử lý logic mật khẩu 2FA nếu có
          return window.prompt('Nhập mật khẩu 2FA của bạn:') || '';
        }
      ).then(() => {
        if (isMounted) onLogin();
      }).catch(err => {
        console.error("QR Error:", err);
        if (isMounted) {
          setError('Lỗi QR: ' + String(err.message || err));
          setLoading(false);
        }
      });
    }

    return () => { isMounted = false; };
  }, [loginMethod, onLogin]);

  const handleSendCode = async () => {
    if (!phoneNumber) return;
    setLoading(true);
    setError('');
    try {
      const res = await sendPhoneCode(phoneNumber);
      setPhoneCodeHash(res.phoneCodeHash);
      setStep('code');
    } catch (err: any) {
      console.error("Phone Error:", err);
      setError('Lỗi: ' + String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      await signInWithPhone(phoneNumber, phoneCodeHash, code);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Mã xác nhận không đúng');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper" style={{ minHeight: '100vh', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card animate-fade-in" style={{ maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--accent-primary)', fontWeight: 700 }}>TeleDrive</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Unlimited Cloud Storage via Telegram</p>
        </div>

        {error && <p style={{ color: 'red', marginBottom: '16px', fontSize: '14px' }}>{error}</p>}

        {loginMethod === 'qr' ? (
          <div className="qr-container" style={{ marginBottom: '24px' }}>
            <div 
              style={{ 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '200px', 
                height: '200px', 
                margin: '0 auto', 
                background: 'white',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                padding: '16px'
              }}
            >
              {loading && !qrUrl ? (
                <div style={{ animation: 'pulse-ring 1s infinite cubic-bezier(0.4, 0, 0.2, 1)', border: '2px solid var(--accent-primary)', borderRadius: '50%', width: '40px', height: '40px' }} />
              ) : qrUrl ? (
                <QRCodeSVG value={qrUrl} size={160} fgColor="#111827" />
              ) : (
                <QrCode size={160} color="#111827" />
              )}
            </div>
            <p style={{ marginTop: '16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              Mở ứng dụng Telegram trên điện thoại &gt; Settings &gt; Devices &gt; Link Desktop Device để đăng nhập.
            </p>
          </div>
        ) : (
          <div className="phone-login-container" style={{ marginBottom: '24px', textAlign: 'left' }}>
            {step === 'phone' ? (
              <>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>Số điện thoại (kèm mã quốc gia)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="input" 
                    placeholder="+84 123 456 789" 
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleSendCode} disabled={loading}>
                    <ArrowRight size={20} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>Mã xác nhận (Gửi qua Telegram)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="input" 
                    placeholder="12345" 
                    value={code}
                    onChange={e => setCode(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleVerifyCode} disabled={loading}>
                    <ArrowRight size={20} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <button 
            className={`btn ${loginMethod === 'qr' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setLoginMethod('qr')}
            style={{ flex: 1 }}
          >
            <QrCode size={18} /> Mã QR
          </button>
          <button 
            className={`btn ${loginMethod === 'phone' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setLoginMethod('phone'); setStep('phone'); }}
            style={{ flex: 1 }}
          >
            <Phone size={18} /> Số điện thoại
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
