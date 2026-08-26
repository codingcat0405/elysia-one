import { Redis } from "ioredis";
import * as crypto from "crypto";

class RedisLock {
  private client: Redis;
  private unlockScript: string;
  constructor(redisClient: Redis) {
    this.client = redisClient;
    this.unlockScript = `
      if redis.call("get",KEYS[1]) == ARGV[1] then
          return redis.call("del",KEYS[1])
      else
          return 0
      end
    `;
  }

  // Generate unique random value
  generateToken() {
    return crypto.randomBytes(20).toString('hex');
  }

  // Acquire lock
  async acquire(resource: string, ttl = 30000) {

    const token = this.generateToken();
    const result = await this.client.set(resource, token, 'PX', ttl, 'NX');

    if (result === 'OK') {
      return token; // Return token if lock acquired
    }
    return null; // Lock not acquired
  }

  // Release lock
  async release(resource: string, token: string) {
    const result = await this.client.eval(this.unlockScript, 1, resource, token);
    return result === 1; // True if released, false otherwise
  }
}

export default RedisLock;