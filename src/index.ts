import qrcode from 'qrcode-terminal';
import { WhatsAppProxyApp } from './app.js';
import { config } from './config.js';

const app = new WhatsAppProxyApp(config);

app.client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

await app.start();

const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[index] ${signal} recibido. Apagando...`);
    await app.stop();
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
