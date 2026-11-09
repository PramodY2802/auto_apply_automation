import { createSandboxServer } from './server';

const port = Number(process.env.SANDBOX_PORT ?? 4100);
const server = createSandboxServer({ publicUrl: process.env.SANDBOX_PUBLIC_URL });
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', service: 'sandbox-board', msg: `Sandbox job board on :${port}` })));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
