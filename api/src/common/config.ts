/**
 * Configuração lida do ambiente, validada na inicialização.
 * Em produção, a API se recusa a subir com segredos ausentes ou fracos.
 */
function required(name: string, fallbackForDev?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV !== 'production' && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
}

export const config = {
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
  get port() {
    return Number(process.env.PORT ?? 3000);
  },
  get webUrl() {
    return process.env.WEB_URL ?? 'http://localhost:5173';
  },
  get jwtSecret() {
    return required('JWT_SECRET', 'dev-only-jwt-secret-change-me-0123456789abcdef');
  },
  /** 32 bytes em base64 — chave AES-256-GCM para CPF e segredos de integrações. */
  get dataEncryptionKey() {
    return required('DATA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  },
  /** Chave HMAC para gerar hash pesquisável de CPF. */
  get dataHashKey() {
    return required('DATA_HASH_KEY', 'dev-only-hash-key-change-me');
  },
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  passwordResetTtlMinutes: 60,
  maxFailedLogins: 5,
  lockMinutes: 15,
  refreshCookieName: 'fisio_rt',
  get emailProvider() {
    return (process.env.EMAIL_PROVIDER ?? 'mock') as 'mock' | 'smtp';
  },
  get whatsappProvider() {
    return (process.env.WHATSAPP_PROVIDER ?? 'mock') as 'mock' | 'cloud';
  },
};

export function assertProductionSecrets() {
  if (!config.isProd) return;
  if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET deve ter ao menos 32 caracteres');
  if (Buffer.from(config.dataEncryptionKey, 'base64').length !== 32)
    throw new Error('DATA_ENCRYPTION_KEY deve ter 32 bytes em base64 (openssl rand -base64 32)');
  if (config.dataHashKey.length < 32) throw new Error('DATA_HASH_KEY deve ter ao menos 32 caracteres');
}
