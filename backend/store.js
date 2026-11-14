import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class EncryptedStore {
  constructor(directory, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte encryption key is required.');
    this.key = key;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, 'passengers.enc');
    this.records = {};
    if (existsSync(this.path)) {
      const payload = JSON.parse(readFileSync(this.path, 'utf8'));
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      this.records = JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()
      ]).toString('utf8'));
    }
  }

  save() {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.records), 'utf8'), cipher.final()]);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
    }), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  purge(now) {
    let changed = false;
    for (const [id, passenger] of Object.entries(this.records)) {
      if (now >= Date.parse(passenger.profile.arrival) + 24 * 60 * 60_000) {
        delete this.records[id];
        changed = true;
      }
    }
    if (changed) this.save();
  }
}
