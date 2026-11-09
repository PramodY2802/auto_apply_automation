process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 9).toString('base64')}`;
process.env.LOCAL_STORAGE_PATH ??= '/tmp/aa-api-test-storage';
