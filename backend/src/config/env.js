import 'dotenv/config';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];

const missing = REQUIRED.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS || '*',

  // Number of proxies in front of the app (1 = Render or Nginx, 2 = Cloudflare + Render)
  trustProxy: Number(process.env.TRUST_PROXY || 1),

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  autoApproveRecharge: process.env.AUTO_APPROVE_RECHARGE === 'true',
  meterOnlineSeconds: Number(process.env.METER_ONLINE_SECONDS || 180),
  timezone: process.env.APP_TIMEZONE || 'Asia/Dhaka',
};
