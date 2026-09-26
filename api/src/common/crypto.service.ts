import { Global, Injectable, Module } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { config } from './config';

/**
 * Criptografia centralizada:
 *  - senhas: Argon2id
 *  - tokens opacos (refresh, reset): aleatórios de 256 bits, guardados como SHA-256
 *  - dados sensíveis (CPF, segredos): AES-256-GCM com IV aleatório; formato "v1:iv:tag:dados" (base64)
 *  - busca exata sem revelar o valor: HMAC-SHA256 (ex.: cpfHash)
 */
@Injectable()
export class CryptoService {
  private readonly key = Buffer.from(config.dataEncryptionKey, 'base64');

  hashPassword(plain: string) {
    return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verifyPassword(hash: string, plain: string) {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  hmac(value: string) {
    return createHmac('sha256', config.dataHashKey).update(value).digest('hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1') throw new Error('Formato de dado cifrado desconhecido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /** CPF: guarda cifrado + hash para busca. Aceita com ou sem máscara. */
  protectCpf(cpf: string) {
    const digits = cpf.replace(/\D/g, '');
    return { cpfEncrypted: this.encrypt(digits), cpfHash: this.hmac(`cpf:${digits}`) };
  }

  cpfLookupHash(cpf: string) {
    return this.hmac(`cpf:${cpf.replace(/\D/g, '')}`);
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
